const SecretsManagerService = require('./secretsmanager.service');
const JwtService = require('./jwt.service');
const RedisService = require('./redis.service');
const DatabaseService = require('./database.service');
const SamsungAccountManager = require('./samsungaccount.service');
const DynamoDBService = require('./dynamo.service');
const { checkResourcePermission } = require('./resourceAccess.service');
const DeviceAuthService = require('./deviceauth.service');
const { match } = require('path-to-regexp');
const { hash } = require('./dkms.service');
const { logger } = require('./logger.service');
const { validateAccessToken, getCountryCode } = require('./util.service');
const { isNil } = require('lodash');
const { COMMON_AUTH_TERMS_TTL_IN_SEC } = require('../const/cache.const');
let redisService, umsService, deviceAuthService;
let samsungAccountManager, dynamoDB, jwtService;
let parsedSecret;
class AuthenticateService {
    constructor(type, region, authSecretName, umsSecretName) {
        this.type = type;
        this.region = region;
        this.authSecretName = authSecretName ? authSecretName : undefined;
        this.umsSecretName = umsSecretName ? umsSecretName : undefined;
        this.termsBypassUrls = ['/users', '/thirdparty'];
    }

    init = async () => {
        if (!redisService) {
            const secretManager = new SecretsManagerService(this.authSecretName, this.region);
            const secret = await secretManager.getSecrets();
            parsedSecret = JSON.parse(secret);
            const { redisHost, redisPort } = parsedSecret;
            redisService = new RedisService(redisHost, redisPort);
        }
        if (!deviceAuthService) {
            const secretManager = new SecretsManagerService(this.authSecretName, this.region);
            const secret = await secretManager.getSecrets();
            parsedSecret = JSON.parse(secret);
            const { screenAuthRedisHost, screenAuthRedisPort } = parsedSecret;
            deviceAuthService = new DeviceAuthService({ type: 'AUTHENTICATION', region: this.region, screenAuthHost: screenAuthRedisHost, screenAuthPort: screenAuthRedisPort });
        }
        if (!umsService) {
            umsService = new DatabaseService(
                { region: this.region, secretManagerName: this.umsSecretName, instanceName: 'ums' },
            );
        }

        if (!samsungAccountManager) {
            samsungAccountManager = new SamsungAccountManager();
        }

        if (!dynamoDB) {
            dynamoDB = DynamoDBService.getInstance(this.region);
        }

        if (!jwtService) {
            jwtService = new JwtService(true);
        }
    };

    setAuthentication = async (userId, email, orgId, placeId, roleId) => {
        return await this.generatePolicy(userId, email, orgId, placeId, roleId);
    };

    generatePolicy = async (userId, email, orgId, placeId, roleId) => {
        let accessControlList;
        logger.info(`[AUTH][${userId}] generate policy for user`, userId, email, orgId, placeId);
        let accessAPI = await dynamoDB.get({
            TableName: 'fcms-auth-accessApi-dm',
            Key: {
                Resource_Name: this.type,
            },
        });
        accessAPI = accessAPI.Item.Resources;
        if (!roleId) {
            accessControlList = accessAPI['NONE'];
            logger.info('No place and role', accessControlList);
        } else {
            accessControlList = accessAPI[`${roleId.toUpperCase()}`];
        }
        Object.values(accessControlList).forEach((arr) => {
            arr.forEach((value, index, array) => {
                array[index] = value.replace('${orgId}', orgId).replace('${wId}', placeId).replace(`${userId}`, userId).replace(`${email}`, email);
            });
        });
        return accessControlList;
    };

    verifyDeviceToken = async (devicetoken) => {
        const decode = jwtService.decoded(devicetoken);
        const { id, client: module } = decode;
        const client = (module === 'PLAYER') ? 'PLAYER' : 'RM';
        logger.info(`[AUTH][devicetoken][${client}][${id}]`);
        const result = await deviceAuthService.verify(devicetoken, 'DISPLAY', id, client);
        if (result) {
            return;
        } else {
            throw new Error('Unauthorized');
        }
    };

    verifySystemToken = async (token) => {
        const decode = jwtService.decoded(token);
        const { hmac: hmacFromHeader } = decode;
        const systemToken = await redisService.get(token);
        const { hmac: hmacFromRedis } = systemToken;
        if (hmacFromHeader !== hmacFromRedis) {
            throw new Error('Unauthorized');
        }
        return;
    };

    updateTermsBypassUrls(newSkipUrls) {
        this.termsBypassUrls = this.termsBypassUrls.concat(newSkipUrls);
    }

    verifyUserTerms = async (userId, countryCode) => {
        try {
            countryCode = countryCode.toUpperCase();
            logger.info(`[VERIFY TERMS][userId = ${userId}][countryCode = ${countryCode}]`);
            const agreementQuery = `
            WITH LatestTerms AS (
            SELECT
                TERM_ID,
                TERM_TYPE,
                TERM_VERSION,
                TERM_REGION,
                ROW_NUMBER() OVER (PARTITION BY TERM_TYPE ORDER BY TERM_VERSION DESC) AS RN
            FROM
                UMS_TERM
            WHERE
                (TERM_REGION = $1 OR TERM_REGION = 'Common' OR TERM_REGION = 'Default') AND
                IS_MANDATORY = TRUE
            )
            SELECT
                lt.TERM_ID,
                lt.TERM_VERSION
            FROM
                LatestTerms lt
            LEFT JOIN UMS_USER_TERM_AGREEMENT uta
                ON lt.TERM_ID = uta.TERM_ID AND uta.USER_ID = $2
            WHERE
                lt.RN = 1 AND (TERM_REGION = $1 OR TERM_REGION = 'Common') AND (uta.IS_AGREED IS NULL OR uta.IS_AGREED = FALSE)
            
            UNION ALL
            
            SELECT
                ltd.TERM_ID,
                ltd.TERM_VERSION
            FROM
                LatestTerms ltd
            LEFT JOIN UMS_USER_TERM_AGREEMENT uta
                ON ltd.TERM_ID = uta.TERM_ID AND uta.USER_ID = $2
            WHERE
                ltd.RN = 1 AND TERM_REGION = 'Default' AND (uta.IS_AGREED IS NULL OR uta.IS_AGREED = FALSE) AND
                NOT EXISTS (
                    SELECT 1
                    FROM UMS_TERM ut
                    WHERE ut.TERM_TYPE = ltd.TERM_TYPE AND ut.TERM_REGION = $1
                ) 
            `;
            const agreementNeeded = await umsService.selectRows({
                query: agreementQuery,
                values: [countryCode, userId],
            });
            if (agreementNeeded && agreementNeeded.length > 0) {
                logger.info('[AGREEMENT REQUIRED]', agreementNeeded);
                return false;
            }
            const now = Date.now();
            await redisService.set(`commonAuth-user-terms:${userId}`, {
                updatedTime: now,
            }, COMMON_AUTH_TERMS_TTL_IN_SEC);
        } catch (e) {
            logger.error(e);
        }
        return true;
    };

    authenticate = async (req, res, next) => {
        await this.init();
        let { originalUrl, method, params } = req;
        params = Object.assign({}, params);
        const token = (req.cookies && req.cookies.token) || undefined;
        const authorization = req.header('authorization');
        const OpenApiToken = req.headers['openapitoken'];
        const devicetoken = req.header('devicetoken') || undefined;
        const currentTime = new Date();
        const accessLogString = `[${currentTime.toISOString()}][${method}] ${originalUrl}`;
        console.log('\x1b[33m%s\x1b[0m', `${accessLogString} begin.....`);
        console.time(accessLogString);
        let roleChangedData;
        try {
            if (!isNil(OpenApiToken)) {
                logger.info('[OpenApiRequest]');
                const openApiOrg = req.header('organizationId');
                const openApiApp = req.header('appId');
                if (!openApiOrg || !openApiApp) {
                    logger.error('[ERROR]: Missing Organization Id or App Id in header');
                    throw new Error('Unauthorized');
                }
                const redisOpenApiKey = 'OpenApi_' + openApiOrg + '_' + openApiApp;
                const tokenFromRedis = await redisService.get(redisOpenApiKey);
                if (!tokenFromRedis || tokenFromRedis !== OpenApiToken) {
                    logger.error('[ERROR]: OpenAPI token mismatch or not found');
                    throw new Error('Unauthorized');
                }
                next();
                return;
            }
            if (devicetoken) {
                await this.verifyDeviceToken(devicetoken);
                next();
                return;
            } else if (token || authorization) {
                const key = authorization ? authorization : token; // key = accessToken
                const decode = jwtService.decoded(key);
                if (decode) {
                    if (decode.tokenType === 'ds') {
                        await this.verifyDeviceToken(key);
                        next();
                        return;
                    } else if (decode.tokenType === 'system') {
                        await this.verifySystemToken(key);
                        next();
                        return;
                    }
                    const { account: { userName: decodeUserName, userId: decodedUserId, email }, organizations: org, userInfo: { picture: picture }, lastPlace, exp, tokenType, iat = false } = decode;
                    let { placeId, roleId } = lastPlace || {};
                    const organizationId = org && org.length > 0 && org[0].organizationId;
                    const saToken = await redisService.get(key);
                    if (!saToken) {
                        logger.info(`[${decodedUserId}] token was expired`);
                        throw new Error('Unauthorized');
                    }
                    try { // Check Samsung Account Validation
                        const saTokenValid = await redisService.get(saToken + '__valid');
                        if (!saTokenValid || !saTokenValid.isValid) {
                            const isValid = await validateAccessToken(saToken, parsedSecret, token);
                            logger.info('isValid - FROM Samsung Account', isValid);
                            if (!isValid) {
                                throw new Error('Unauthorized');
                            } else {
                                await redisService.set(saToken + '__valid', { isValid: isValid }, 60 * 30); // set empty object for 30 minutes
                            }
                        }
                    } catch (e) {
                        logger.error(e);
                        throw e;
                    }
                    const validUser = await umsService.selectRows({
                        query: `SELECT 1 FROM UMS_USER WHERE USER_ID = $1 AND USER_STATUS = $2`,
                        values: [decodedUserId, 'registered'],
                    });
                    if (validUser && validUser.length === 1 && !(this.termsBypassUrls.some(url => originalUrl.includes(url)))) {
                        const userTermsVerified = await redisService.get(`commonAuth-user-terms:${decodedUserId}`) || {};
                        const countryCode = getCountryCode(req);
                        if (!userTermsVerified || Object.keys(userTermsVerified).length === 0) {
                            if (await this.verifyUserTerms(decodedUserId, countryCode) === false) {
                                throw new Error('MISSING_MANDATORY_AGREEMENTS');
                            }
                        }
                    }
                    let [accessControlList, accessControlListMismatch, placeUsersRequest] = [[], [], []];
                    let authResultMismatch = false;
                    let generatePolicyMismatch = false;
                    if (tokenType === 'admin') { // admin-hub
                        logger.info('Get ACL for admin-hub');
                        accessControlList = {
                            GET: ['/api/ums/(.*)', '/customsso/(.*)'],
                            DELETE: ['/api/ums/admin/(.*)', '/customsso/(.*)'],
                            POST: ['/api/ums/admin/(.*)', '/customsso/(.*)'],
                            PUT: ['/api/ums/admin/(.*)', '/customsso/(.*)'],
                        };

                        const authResult = accessControlList[method.toUpperCase()]
                            ? accessControlList[method.toUpperCase()].some((api) => {
                                    const urlMatch = match(api, { decode: decodeURIComponent });
                                    let originalUrlWithoutQuery = originalUrl.split('?')[0];
                                    return urlMatch(originalUrlWithoutQuery) != false;
                                })
                            : false;

                        if (!authResult) {
                            throw new Error(`Forbidden`);
                        }
                        next();
                        return;
                    } else {
                        logger.info('Get ACL for normal user');
                        // TODO: check organization from jwt
                        const orgUsers = await umsService.selectRows({
                            query: `SELECT ROLE_ID FROM UMS_ORGANIZATION_RELATION_USER WHERE USER_ID = $1 AND ORGANIZATION_ID = $2`,
                            values: [decodedUserId, org[0].organizationId],
                        });
                        if (!orgUsers || orgUsers.length <= 0) {
                            throw new Error('USER_WITHDRAW');
                        } else if (orgUsers[0].roleId != org[0].roleId) {
                            throw new Error('ROLE_CHANGED');
                        }
                        if (orgUsers[0].roleId != 'ROLE_OWNER' && !placeId) {
                            throw new Error('USER_NO_ASSIGNED_PLACE');
                        }

                        if (orgUsers[0].roleId != 'ROLE_OWNER' && placeId) {
                            const placeUsers = await umsService.selectRows({
                                query: `SELECT ROLE_ID FROM UMS_PLACE_RELATION_USER WHERE USER_ID = $1 AND PLACE_ID = $2`,
                                values: [decodedUserId, placeId],
                            });
                            if (placeUsers && placeUsers.length > 0) {
                                if (placeUsers[0].roleId != roleId) {
                                    roleChangedData = {
                                        old: roleId,
                                        new: placeUsers[0].roleId,
                                    };
                                    throw new Error('ROLE_CHANGED');
                                }
                            } else {
                                const placeUsersChangeCheck = await umsService.selectRows({
                                    query: `SELECT ROLE_ID, PLACE_ID FROM UMS_PLACE_RELATION_USER WHERE USER_ID = $1`,
                                    values: [decodedUserId],
                                });
                                if (placeUsersChangeCheck && placeUsersChangeCheck.length > 0) {
                                    placeId = placeUsersChangeCheck[0].placeId;
                                    roleId = placeUsersChangeCheck[0].roleId;
                                } else {
                                    throw new Error('USER_NO_ASSIGNED_PLACE'); // USER_NO_ASSIGNED_PLACE
                                }
                            }
                        }

                        if (params.placeId && placeId && params.placeId != placeId) {
                            placeUsersRequest = await umsService.selectRows({
                                query: `SELECT ROLE_ID FROM UMS_PLACE_RELATION_USER WHERE USER_ID = $1 AND PLACE_ID = $2`,
                                values: [decodedUserId, params.placeId],
                            });
                            const placeUsersOrgRequest = await umsService.selectRows({
                                query: `SELECT PLACE_ID FROM UMS_ORGANIZATION_RELATION_PLACE WHERE ORGANIZATION_ID = $1 AND PLACE_ID = $2`,
                                values: [organizationId, params.placeId],
                            });
                            if ((orgUsers[0].roleId == 'ROLE_OWNER' && placeUsersOrgRequest?.length > 0) || (placeUsersRequest && placeUsersRequest.length > 0)) {
                                generatePolicyMismatch = true;
                            }
                        }

                        if (params.hasOwnProperty('organizationId') && params.hasOwnProperty('placeId') && params.hasOwnProperty('id')) { // ResourceId is present, so check if the requested resource is valid for the user
                            const resourcePermissionObj = {
                                orgId: params.organizationId,
                                placeIdList: [params.placeId],
                                resourceId: params.id,
                                accessList: [],
                                resourceUri: originalUrl,
                                userId: decodedUserId,
                            };
                            const isAllowedOnResource = await checkResourcePermission(resourcePermissionObj);
                            if (!isAllowedOnResource) {
                                throw new Error('Forbidden');
                            }
                        }

                        if (generatePolicyMismatch) {
                            accessControlListMismatch = await redisService.get(this.type + iat + params.placeId + key + '__acl');

                            if (!accessControlListMismatch) {
                                accessControlListMismatch = await this.setAuthentication(decodedUserId, email, organizationId, params.placeId, orgUsers[0].roleId == 'ROLE_OWNER' ? 'ROLE_OWNER' : placeUsersRequest[0].roleId);
                                await redisService.set(this.type + iat + params.placeId + key + '__acl', accessControlListMismatch, exp - new Date().getTime() / 1000);
                            }

                            authResultMismatch = accessControlListMismatch[method.toUpperCase()]
                                ? accessControlListMismatch[method.toUpperCase()].some((api) => {
                                        const urlMatch = match(api, { decode: decodeURIComponent });
                                        let originalUrlWithoutQuery = originalUrl.split('?')[0];
                                        return urlMatch(originalUrlWithoutQuery) != false;
                                    })
                                : false;

                            if (!authResultMismatch) {
                                throw new Error(`Forbidden`);
                            }
                        }

                        accessControlList = await redisService.get(this.type + iat + decodedUserId + key + '__acl');

                        if (!accessControlList) {
                            accessControlList = await this.setAuthentication(decodedUserId, email, organizationId, placeId, roleId);
                            await redisService.set(this.type + iat + decodedUserId + key + '__acl', accessControlList, exp - new Date().getTime() / 1000);
                        }
                    }
                    const authResult = accessControlList[method.toUpperCase()]
                        ? accessControlList[method.toUpperCase()].some((api) => {
                                const urlMatch = match(api, { decode: decodeURIComponent });
                                let originalUrlWithoutQuery = originalUrl.split('?')[0];
                                return urlMatch(originalUrlWithoutQuery) != false;
                            })
                        : false;
                    if (!authResult && !authResultMismatch) {
                        throw new Error(`Forbidden`);
                    }

                    if (this.type === 'UMS') {
                        const userEmailHash = await hash(email, 'email');
                        await umsService.updateRow({ // isSuperAdmin, userId
                            table: 'UMS_USER',
                            columnsValues: {
                                LAST_ACTIVITY_TIME: 'NOW()',
                            },
                            wheres: {
                                EMAIL_HASH: userEmailHash,
                            },
                            returning: '*',
                        });
                    }

                    const userContext = {
                        userName: decodeURI(decodeUserName),
                        userEmail: email,
                        organization: org && org.length > 0 ? org[0] : {},
                        userId: decodedUserId,
                        userPicture: picture,
                    };
                    req.userContext = userContext;
                } else {
                    throw new Error('jwt is wrong');
                }
                next();
            } else {
                throw new Error('there is no token');
            }
        } catch (e) {
            logger.info(`[ERROR] ${e.message}`, e.stack);
            logger.error(e);
            switch (e.message) {
                case 'Forbidden':
                    res.status(403).json({
                        resultCode: 403,
                        resultMessage: e.message,
                    });
                    break;
                case 'MISSING_MANDATORY_AGREEMENTS':
                    res.status(403).json({
                        resultCode: 70001,
                        resultMessage: 'Missing mandatory agreements',
                    });
                    break;
                case 'USER_WITHDRAW':
                    res.status(401).json({
                        resultCode: 40401,
                        resultMessage: 'User withdrawal',
                    });
                    break;
                case 'ROLE_CHANGED':
                    res.status(401).json({
                        resultCode: 40104,
                        resultMessage: `User's role is changed.`,
                        data: (roleChangedData.old && roleChangedData.new) ? roleChangedData : undefined,
                    });
                    break;
                case 'Unauthorized':
                    res.status(401).json({
                        resultCode: 401,
                        resultMessage: e.message,
                    });
                    break;
                case 'USER_NO_ASSIGNED_PLACE':
                    res.status(200).json({
                        resultCode: 200,
                        resultMessage: e.message,
                        places: [],
                    });
                    break;
                default:
                    logger.info('Unknown error');
                    res.status(401).json({
                        resultCode: 401,
                        resultMessage: e.message,
                    });
            }
        } finally {
            console.timeEnd(accessLogString);
        }
    };
}

module.exports = AuthenticateService;

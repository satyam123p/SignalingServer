const deleteUserIfOnlyInThisPlace = async ({ usersToDelete, placeIds, region, organizationId, cookies }) => {
    try {
        const payload = {
            queryStringParameters: {
                isPlaceDeleted: true,
            },
            body: {
                userIds: usersToDelete,
                placeIds: placeIds,
            },
            cookies: cookies,
            pathParameters: {
                organizationId: organizationId,
            },
        };
        const lambdaService = new LambdaService(region, process.env.ECS);
        await lambdaService.invoke('DELETE_USERS', payload, 'Event');
    } catch (e) {
        logger.error('[USERS DELETE] Failed.', e);
    }
};

const checkTagsetLock = async (tagsetId, db) => {
    const tagset = await db.selectRows({
        text: `SELECT IS_LOCK FROM AMS_TAGSET WHERE TAGSET_ID = $1`,
        values: [tagsetId],
    });
    if (tagset && tagset.length > 0 && tagset[0].isLock == true) {
        throw handleError('LOCKED', `The tagset is locked. You can't modify it.`);
    }
};

const getDuplicateName = (contentList, originalName, contentType) => {
    let duplicateName;
    const originalNameLength = originalName.length;
    let hash = new Array(contentList.length + 2).fill(-1);

    for (let i = 0; i < contentList.length; i = i + 1) {
        let currentName = '';
        if (contentType === 'CONTENT') {
            currentName = contentList[i].contentName;
        } else if (contentType === 'PLAYLIST') {
            currentName = contentList[i].playlistName;
        } else if (contentType === 'PROGRAM') {
            currentName = contentList[i].programName;
        }

        const duplicationNumber = Number(currentName.substring(currentName.indexOf('(', originalNameLength) + 1, currentName.indexOf(')', originalNameLength)));

        if (duplicationNumber <= contentList.length) {
            hash[duplicationNumber] = 1;
        }
    }
    for (let i = 1; i < hash.length; i++) {
        if (hash[i] === -1) {
            duplicateName = originalName + ` (${i})`;
            break;
        }
    }
    return duplicateName;
};

const findDuplicateName = async (fileName, tableName, columnName, organizationId, placeId, dbInstance, conn, callerName) => {
    if (!dbInstance) {
        throw handleError('INTERNAL_SERVER_ERROR', 'Database Object Not Defined');
    }
    let result;
    let newFileName = fileName + '____%';
    logger.info(`[${callerName.toUpperCase()}][newFileName]`, newFileName);
    try {
        result = await dbInstance.selectRows(
            {
                text: `SELECT * FROM ${tableName}
          WHERE ${columnName} LIKE $1 AND ORGANIZATION_ID = $2 AND PLACE_ID = $3 AND IS_DELETED = 'FALSE'
          ORDER BY ${columnName} ASC`,
                values: [newFileName, organizationId, placeId],
            },
            conn,
        );
        logger.info('result length: ', result.length);
        logger.info('result : ', result);
    } catch (error) {
        logger.error(error);
        throw handleError('INTERNAL_SERVER_ERROR', `Failed to get duplicate ${callerName.toUpperCase()} name`);
    }
    const duplicateFileName = getDuplicateName(result, fileName, callerName);
    return duplicateFileName;
};

const addResponseHeader = (key, value, oriHeaders) => {
    const headers = oriHeaders ? oriHeaders : {};
    headers[key] = value;
    return headers;
};

const isUserExistsInOrganizationByUserId = async (orgId, userId, db) => {
    let isAllowed = false;
    try {
        const userOrgId = await db.selectRows({
            query: `SELECT ORGANIZATION_ID FROM UMS_ORGANIZATION_RELATION_USER WHERE USER_ID = $1`,
            values: [userId],
        });
        if (userOrgId && userOrgId.length === 0) {
            throw new Error('User is not in any organization');
        }
        isAllowed = userOrgId[0].organizationId === orgId;
    } catch (err) {
        logger.error(err);
        throw err;
    }
    return isAllowed;
};

const getExtension = (filename) => {
    return filename.split('.').pop().toLowerCase();
};
const maskSensitiveNameWithAsterisk = (name) => {
    let encodeNameReg = /(?<!^).(?!$)/g;
    return name.replace(encodeNameReg, '*');
};

const isPIRSContent = async (mediaType, type = '') => {
    if (mediaType === 'VX' && type && (type.includes('ART') || type.includes('CDNG') || type.includes('RENG') || type.includes('LPWI'))) {
        return true;
    }
    return false;
};

const isValidUUID = async (uuidStr, param = 'UUID') => {
    if (!validator.isUUID(uuidStr)) {
        throw handleError('INVALID_PARAMETER_VALUE', `Please enter valid ${param}`);
    }
    return true;
};

const isValidEmail = async (emailID) => {
    if (!validator.isEmail(emailID)) {
        throw handleError('INVALID_PARAMETER_VALUE', `${emailID} is invalid email`);
    }
    return true;
};
const getS3KeyPop = async (organizationId, placeId, popId, db) => {
    const dataQuery = `SELECT START_DATE, END_DATE FROM UMS_POP_EXPORT WHERE PLACE_ID = $1 AND ORGANIZATION_ID = $2 AND POP_EXPORT_ID = $3`;
    let data = await db.selectRows({
        query: dataQuery,
        values: [placeId, organizationId, popId],
    });
    let startYear = data[0].startDate.getFullYear();
    let startMonth = String(data[0].startDate.getMonth() + 1).padStart(2, '0');
    let startDay = String(data[0].startDate.getDate()).padStart(2, '0');
    let startDate = `${startYear}-${startMonth}-${startDay}`;
    let endYear = data[0].endDate.getFullYear();
    let endMonth = String(data[0].endDate.getMonth() + 1).padStart(2, '0');
    let endDay = String(data[0].endDate.getDate()).padStart(2, '0');
    let endDate = `${endYear}-${endMonth}-${endDay}`;
    return `organization/${organizationId}/${placeId}/pop/${popId}_${startDate}_${endDate}.zip`;
};

const extractTokenFromCookie = (headers) => {
    const { cookie } = headers;
    if (cookie) {
        const token = cookie.match(/((?<!_)token\=[^;]*)/g);
        const tokenValue = token ? token[0].split('=')[1] : null;
        if (tokenValue) {
            return tokenValue;
        } else {
            logger.info('[ERROR] there is no token in cookie');
            throw new Error('Forbidden');
        }
    } else {
        logger.info('[ERROR] there is no cookie');
        throw new Error('Forbidden');
    }
};

const makeQuery = (name, array, caseType, operator = 'AND', typeOperator) => {
    if (operator != 'AND' && operator != 'OR') {
        throw `Invalid Operator : ${operator}`;
    }

    if (typeOperator && typeOperator != 'AND' && typeOperator != 'OR') {
        throw `Invalid Type Operator : ${typeOperator}`;
    }

    if (!typeOperator) {
        typeOperator = operator;
    }

    if (array.length > 0) {
        const values = [];
        let query = ` ${operator} (`;
        array.forEach((a, index) => {
            query += `${name} = ? ${index < array.length - 1 ? ` ${typeOperator} ` : ``}`;
            if (caseType && caseType == 'lower') {
                values.push(a.toLowerCase());
            } else {
                values.push(a.toUpperCase());
            }
        });
        query += `)`;
        return {
            query: query,
            values: values,
        };
    }
    return '';
};

const makeShareQuery = (array, operator = 'AND') => {
    if (operator != 'AND' && operator != 'OR') {
        throw `Invalid Operator : ${operator}`;
    }
    if (array.length > 0) {
        let query = ` ${operator} (`;
        array.forEach((a, index) => {
            switch (a) {
                case 'shared':
                    query += `(A.IS_SHARED = TRUE AND D.SHARED IS NULL) ${index >= 0 && index < array.length - 1 ? ` ${operator} ` : ``}`;
                    break;
                case 'notShared':
                    query += `(A.IS_SHARED = FALSE) ${index >= 0 && index < array.length - 1 ? ` ${operator} ` : ``}`;
                    break;
                case 'sharedByOthers':
                    query += `(D.SHARED = TRUE) ${index >= 0 && index < array.length - 1 ? ` ${operator} ` : ``}`;
                    break;
            }
        });
        query += `)`;
        return {
            query: query,
        };
    }
    return '';
};

const makeSearchQuery = (name, array, operator = 'AND', operatorInner) => {
    if (operator != 'AND' && operator != 'OR') {
        throw `Invalid Operator : ${operator}`;
    }
    if (!operatorInner) {
        operatorInner = operator;
    }
    if (array.length > 0) {
        const values = [];
        let query = ` ${operator} (`;
        array.forEach((a, index) => {
            query += `UPPER(${name}) LIKE UPPER(?) ${index < array.length - 1 ? ` ${operatorInner} ` : ``}`;
            values.push(`%${a.toUpperCase()}%`);
        });
        query += `)`;
        return {
            query: query,
            values: values,
        };
    }
    return '';
};

const getOrderByLastRedis = async (orderBy, order, userId, updateKey, redisService) => {
    let OrderFromRedis;
    try {
        OrderFromRedis = await redisService.get(`order:${userId}:${updateKey}`);

        if (OrderFromRedis && OrderFromRedis.lastOrderBy && OrderFromRedis.lastOrder) {
            const lastOrderBy = OrderFromRedis.lastOrderBy;
            const lastOrder = OrderFromRedis.lastOrder;
            return { lastOrderBy: lastOrderBy, lastOrder: lastOrder };
        }

        return { lastOrderBy: 'updated_time', lastOrder: 'desc' };
    } catch (e) {
        logger.error('[COMMON][ERROR][getOrderByLastRedis]', e);
        return { lastOrderBy: orderBy, lastOrder: order };
    }
};

const updateOrderByLastRedis = async (orderBy, order, userId, updateKey, redisService) => {
    let OrderFromRedis;
    try {
        if (orderBy !== 'default') {
            await redisService.set(
                `order:${userId}:${updateKey}`,
                {
                    lastOrderBy: orderBy,
                    lastOrder: order,
                },
                30 * 24 * 60 * 60,
            ); // 30 days
            return { newOrderBy: orderBy, newOrder: order };
        } else {
            OrderFromRedis = await redisService.get(`order:${userId}:${updateKey}`);
        }
        if (OrderFromRedis && OrderFromRedis.lastOrderBy && OrderFromRedis.lastOrder) {
            orderBy = OrderFromRedis.lastOrderBy;
            order = OrderFromRedis.lastOrder;
            return { newOrderBy: orderBy, newOrder: order };
        }
        return { newOrderBy: 'updated_time', newOrder: 'desc' };
    } catch (e) {
        logger.error('[COMMON][ERROR][updateOrderByLastRedis]', e);
        return { newOrderBy: orderBy, newOrder: order };
    }
};

const revertOrderByLastRedis = async (orderBy, order, userId, updateKey, redisService) => {
    try {
        await redisService.set(
            `order:${userId}:${updateKey}`,
            {
                lastOrderBy: orderBy,
                lastOrder: order,
            },
            30 * 24 * 60 * 60,
        ); // 30 days
    } catch (e) {
        logger.error('[COMMON][ERROR][revertOrderByLastRedis]', e);
    }
};
const fetchIndexJSFiles = async (directoryPath, filesArray, serviceName) => {
    const items = fs.readdirSync(directoryPath);
    items.forEach((item) => {
        const itemPath = path.join(directoryPath, item);
        const stats = fs.statSync(itemPath);
        if (stats.isDirectory()) {
            fetchIndexJSFiles(itemPath, filesArray, serviceName);
        } else if (stats.isFile() && item === 'index.js') {
            const data = fs.readFileSync(itemPath, 'utf8');
            if (data.includes(serviceName)) {
                filesArray.push(itemPath);
            }
        }
    });
};

const validateAccessToken = async (saToken, parsedSecret, token) => {
    const userJWT = await getUserJWT(token);
    if (userJWT && userJWT.isCustomSso) {
        return true;
    }
    const { SAMSUNG_ACCOUNT_CLIENT_SECRET, SAMSUNG_ACCOUNT_CLIENT_ID } = parsedSecret;
    const samsungAccountManagerObj = new SamsungAccountManager();
    const isAccessTokenValid = await samsungAccountManagerObj.validateAccessToken(saToken, SAMSUNG_ACCOUNT_CLIENT_SECRET, SAMSUNG_ACCOUNT_CLIENT_ID);
    return isAccessTokenValid;
};

const getUserJWT = async (token) => {
    try {
        const decode = jwt.decode(token);
        if (decode && decode.account) {
            return decode;
        }
    } catch (e) {
        logger.error(`[ERROR] parse user JWT`, e);
    }
    return null;
};

const getSupportedFileExtensions = () => {
    return {
        image: ['BMP', 'JPG', 'JPEG', 'PNG', 'GIF'],
        video: ['ASF', 'AVI', 'FLV', 'MKV', 'MOV', 'MPEG', 'MPG', 'MP4', 'MTS', 'M2TS', 'VOB', 'VRO', 'WMV', 'SVI', 'TP', 'TRP', 'TS', '3GP'],
        sound: ['MP3'],
        font: ['TTF', 'OTF', 'WOFF', 'WOFF2'],
        html: ['ZIP'],
        vx: ['VX'],
        networkCertificate: ['der', 'pem', 'cer', 'p12', 'pfx'],
        appCertificate: ['der', 'pem', 'cer', 'crt', 'key'],
        office: ['DOC', 'DOCX', 'XLS', 'XLSX', 'PPT', 'PPTX', 'PDF', 'PPS'],
    };
};

const sendRMStatePayloadToSQS = async (redisService, sqsService, notificationSQS, body) => {
    try {
        const { notification, isRetry = undefined } = body;
        if (notification && notification.messageId !== null) {
            let key;
            if (isRetry === true) {
                key = notification.messageId + '-notification-retry';
            } else {
                key = notification.messageId + '-notification';
            }
            // RM State history gets deleted in 7 days
            // Redis stored RM state gets deleted in 7 days plus 1 hour on safer side.
            await redisService.set(key, body, 7 * 24 * 60 * 60 * 1000 + 60 * 60);

            let notiPayload = {
                messageId: notification.messageId,
                isRetry: isRetry ? true : false,
            };

            let data = {
                payload: notiPayload,
                createdTime: new Date().getTime(),
            };

            const params = {
                MessageBody: JSON.stringify({
                    type: 'RM-NOTIFICATION-PAYLOAD',
                    data: data,
                }),
                QueueUrl: notificationSQS,
                MessageGroupId: 'default-group',
            };
            logger.info('sending to notification sqs', JSON.stringify(params));
            await sqsService.sendMessage(params, logger.getLogContext() ?? undefined);
        }
    } catch (error) {
        logger.error(error);
        throw error;
    }
};

const isNumeric = (value) => {
    return /^-?\d+$/.test(value);
};

const getEmptyResponse = (start, rowsPerPage) => {
    const response = {
        rows: [],
        total: 0,
        start: start,
        rowsPerPage: rowsPerPage,
        hasMore: false,
    };
    return response;
};

const getOpenApiHeaderObject = (event) => {
    if (event.headers && event.headers.openapitoken) {
        return {
            openapitoken: event.headers.openapitoken,
            organizationid: event.headers.organizationid,
            appid: event.headers.appid,
        };
    }
    return {};
};

const isPlanXSeries = async (placeId, umsDb, organizationId) => {
    try {
        const planXSeries = ['VX-CXY', 'VX-CXM'];
        const wheres = [];
        if (placeId) {
            wheres.push({
                query: `AND PRS.PLACE_ID = ?`,
                values: [placeId],
            });
        }
        if (organizationId) {
            wheres.push({
                query: `AND S.ORGANIZATION_ID = ?`,
                values: [organizationId],
            });
        }
        wheres.push({
            query: `AND SMC.IS_PRIMARY = TRUE`,
        });
        wheres.push({
            query: `AND SMC.MODEL_CODE IN (${planXSeries.map(plan => `'${plan}'`).join(',')})`,
        });
        wheres.push({
            query: `AND S.EXPIRATION_DONE = FALSE`,
        });
        const isPlanXSeries = await umsDb.selectRows({
            query: `SELECT PRS.PLACE_ID, S.SUBSCRIPTION_ID, S.MODEL_CODE, S.EXPIRATION_DONE, SM.PRO_TRIAL, 
                  SMC.IS_PRIMARY, SMC.PLAN_TYPE
                  FROM UMS_PLACE_RELATION_SUBSCRIPTION PRS
                  LEFT JOIN UMS_SUBSCRIPTION S ON S.SUBSCRIPTION_ID = PRS.SUBSCRIPTION_ID
                  LEFT JOIN UMS_SUBSCRIPTION_META SM ON SM.SUBSCRIPTION_ID = S.SUBSCRIPTION_ID
                  LEFT JOIN UMS_SUBSCRIPTION_MODEL_CODE SMC ON SMC.MODEL_CODE = S.MODEL_CODE`,
            wheres: wheres,
        });

        if (isPlanXSeries.length > 0) {
            logger.info(`[COMMON][util][isPlanXSeries=${isPlanXSeries}]`);
            return true;
        }
        return false;
    } catch (error) {
        logger.error(error);
        throw error;
    }
};

const setPublished = (rows) => {
    rows.map(row => (row.published = row.sharedPublished == null ? row.published : row.sharedPublished));
};

const getLifespan = async (content, userId, role, db) => {
    content.lifespan = {};
    const { contentId } = content;
    const rows = await getLifespanQuery(contentId, db);

    if (rows && rows.length > 0) {
        content.lifespan = rows[0];

        if (content.lifespan.startTime != null && content.lifespan.startTimeOffset != null) {
            content.lifespan.startEpochTime = content.lifespan.startTime.getTime();
            content.lifespan.startTime = convertLifespanTime(content.lifespan.startTime, content.lifespan.startTimeOffset);
        }
        if (content.lifespan.endTime != null && content.lifespan.endTimeOffset != null) {
            content.lifespan.endEpochTime = content.lifespan.endTime.getTime();
            content.lifespan.endTime = convertLifespanTime(content.lifespan.endTime, content.lifespan.endTimeOffset);
        }

        logger.info(`[COMMON][util][getLifespan][lifespan=${JSON.stringify(content.lifespan)}]`);

        await setEmbargoThumbnail(content, userId, role, db);
    }

    return content;
};

const convertLifespanTime = (time, offset) => {
    const utcTime = time.getTime() + time.getTimezoneOffset() * 60 * 1000; // Convert to UTC time
    const offsetHour = parseInt(offset.split(':')[0]);
    const offsetMinute = offsetHour < 0 ? -1 * parseInt(offset.split(':')[1]) : parseInt(offset.split(':')[1]);

    const customTime = utcTime + offsetHour * 60 * 60 * 1000 + offsetMinute * 60 * 1000; // Convert to custom time zone
    const customDate = new Date(customTime);
    const year = customDate.getFullYear();
    const month = (customDate.getMonth() + 1).toString().padStart(2, '0');
    const date = customDate.getDate().toString().padStart(2, '0');
    const hours = customDate.getHours().toString().padStart(2, '0');
    const minutes = customDate.getMinutes().toString().padStart(2, '0');
    return `${year}-${month}-${date}T${hours}:${minutes}:00`;
};

const setEmbargoThumbnail = async (content, userId, role, db) => {
    content.embargoThumbnail = false;

    if (content.lifespan.embargo) {
        if (content.lifespan?.startEpochTime > new Date().getTime()) {
            content.embargoThumbnail = true;

            const resRelationUser = await getLifespanRelationUser(content.contentId, db);

            if (role !== 'ROLE_OWNER' && !resRelationUser.find(relationUser => relationUser.userId === userId)) {
                content.thumbnailId = 'embargo';
            }
        }
    }
};

const getLifespanQuery = async (contentId, db) => {
    let q = `SELECT START_TIME, END_TIME, START_TIME_OFFSET, END_TIME_OFFSET, AUTO_DELETE, EMBARGO FROM CMS_CONTENT_LIFESPAN WHERE CONTENT_ID = $1`;

    let rowdata = await db.selectRows({
        query: q,
        values: [contentId],
    });
    logger.info(`getLifespanQuery API response: ${JSON.stringify(rowdata)}`);
    return rowdata;
};

const getLifespanRelationUser = async (contentId, db) => {
    let q = `SELECT USER_ID FROM CMS_CONTENT_LIFESPAN_RELATION_USER WHERE CONTENT_ID = $1`;

    let rowdata = await db.selectRows({
        query: q,
        values: [contentId],
    });
    logger.info(`getLifespanRelationUser API response: ${JSON.stringify(rowdata)}`);
    return rowdata;
};

const copyLifespan = async (contentId, copyContentId, { db, conn }) => {
    logger.info(`[COMMON][util][copyLifespan][contentId=${contentId}][copyContentId=${copyContentId}]`);
    const rows = await getLifespanQuery(contentId, db);
    if (rows && rows.length > 0) {
        const lifespan = rows[0];
        await insertLifespan(copyContentId, lifespan, { db, conn });

        const relationUsers = await getLifespanRelationUser(contentId, db);
        if (relationUsers && relationUsers.length > 0) {
            await insertLifespanRelationUser(copyContentId, relationUsers, { db, conn });
        }
    }
};

const insertLifespan = async (copyContentId, lifespan, { db, conn }) => {
    await db.insertRow(
        {
            table: 'CMS_CONTENT_LIFESPAN',
            columnsValues: {
                CONTENT_ID: copyContentId,
                START_TIME: lifespan.startTime,
                END_TIME: lifespan.endTime,
                START_TIME_OFFSET: lifespan.startTimeOffset,
                END_TIME_OFFSET: lifespan.endTimeOffset,
                AUTO_DELETE: lifespan.autoDelete,
                EMBARGO: lifespan.embargo,
            },
        },
        conn,
    );
    logger.info('Successfully insert lifespan copy');
};

const insertLifespanRelationUser = async (copyContentId, relationUsers, { db, conn }) => {
    await relationUsers.map((relation) => {
        db.insertRow(
            {
                table: 'CMS_CONTENT_LIFESPAN_RELATION_USER',
                columnsValues: {
                    CONTENT_ID: copyContentId,
                    USER_ID: relation.userId,
                },
            },
            conn,
        );
    });
    logger.info('Successfully insert lifespan relation user copy');
};
const checkJsonError = (err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        return res.status(400).json({
            status: 'error',
            message: 'Invalid JSON payload passed.',
        });
    }
    next(err);
};

const isOwner = async (roleId) => {
    switch (roleId) {
        case 'ROLE_OWNER':
            return true;
        default:
            return false;
    }
};

const handlePresetRelation = async (operation, tableName, columnName, id, userId, useDefault, dbInstance, connection) => {
    const columnsValues = {
        UPDATER_ID: userId,
        UPDATED_TIME: 'NOW()',
    };

    if (operation === 'add') {
        columnsValues.USE_DEFAULT = true;
        columnsValues.IS_DEFAULT = true;
    } else if (operation === 'remove') {
        columnsValues.USE_DEFAULT = false;
        columnsValues.IS_DEFAULT = false;
    } else if (operation === 'update') {
        columnsValues.USE_DEFAULT = useDefault;
    }

    logger.info(`Updating the following column values ${columnsValues} for column name ${columnName} with id: ${id} in table ${tableName}`);
    const result = await dbInstance.updateRow(
        {
            table: tableName,
            columnsValues,
            wheres: {
                [columnName]: id,
            },
            returning: '*',
        },
        connection,
    );

    if (!(result && result.length === 1)) {
        throw handleError('INTERNAL_SERVER_ERROR', `Failed to ${operation} preset relation`);
    } else {
        logger.info(`Preset relation successfully ${operation}ed`, result[0]);
    }
};

const getCountryCodeByCountryName = (countryName) => {
    const countryNameMap = arrayToObjectMap(COUNTRY_LIST, 'name');
    if (countryNameMap[countryName]) {
        return countryNameMap[countryName].code;
    }
    return;
};

const checkScreenType = async (screenType) => {
    switch (screenType) {
        case 'SIGNAGE':
        case 'BUSINESSTV':
        case 'HOTELTV':
        case 'HOSPITALITYTV':
        case 'FLIP':
        case 'INDOORLEDSIGNAGE':
        case 'OUTDOORLEDSIGNAGE':
        case 'E-PAPER':
        case 'ANDROID':
        case 'WINDOWS':
            return true;
        default:
            return false;
    }
};

const checkPINCodeValue = async (value, screenType) => {
    switch (screenType) {
        case 'HOTELTV':
        case 'BUSINESSTV': {
            if (value.length === 4) return true;
            break;
        }
        case 'SIGNAGE':
        case 'INDOORLEDSIGNAGE':
        case 'OUTDOORLEDSIGNAGE':
        case 'E-PAPER':
        case 'FLIP': {
            if (value.length === 6) return true;
            break;
        }
    }
    return false;
};

const isValidNetworkAllowList = async (input) => {
    if (input.trim() === '') {
        return true;
    }
    const entries = input.split(';');
    const pattern = /^(tcp|udp):((\*|[\w+\.-]+)(\.+[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}|\d+\.\d+\.\d+\.\d+):\d+$/;
    for (let entry of entries) {
        if (!pattern.test(entry.trim())) {
            logger.error('Not correct format ', entry);
            return false;
        }
    }
    return true;
};

const checkPresetData = async (data, screenType) => {
    for (const object of data) {
        const { name, value } = object;

        let result = name === 'PINCode' ? await checkPINCodeValue(value, screenType) : true;
        if (!result) {
            return new Error(`Invalid PINCode value - ${value}, screenType - ${screenType}`);
        }

        result = name === 'NetworkAllowedList' ? await isValidNetworkAllowList(value) : true;
        if (!result) {
            return new Error(`Invalid NetworkAllowedList value - ${value}`);
        }

        if (screenType === 'SIGNAGE' || screenType === 'OUTDOORLEDSIGNAGE' || screenType === 'INDOORLEDSIGNAGE') {
            if (!CAPABILITY.SIGNAGE.includes(name)) {
                return new Error(`[${screenType}] Not Support Signage Command Name - ${name}`);
            }
        } else if (screenType === 'HOTELTV') {
            if (!CAPABILITY.HOTELTV.includes(name)) {
                return new Error(`[${screenType}] Not Support HOTELTV Command Name - ${name}`);
            }
        } else if (screenType === 'E-PAPER') {
            if (!CAPABILITY.EPAPER.includes(name)) {
                return new Error(`[${screenType}] Not Support E-paper Command Name - ${name}`);
            }
        } else if (screenType === 'ANDROID') {
            if (!CAPABILITY.ANDROID.includes(name)) {
                return new Error(`[${screenType}] Not Support ANDROID Command Name - ${name}`);
            }
        } else if (screenType === 'WINDOWS') {
            if (!CAPABILITY.WINDOWS.includes(name)) {
                return new Error(`[${screenType}] Not Support WINDOWS Command Name - ${name}`);
            }
        }
    }
    return true;
};

const getPublishedInfo = async (cmsDb, dmsDb, id, index, publishedInfos) => {
    try {
        let windows = false,
            expandedWall = false,
            duplicatedWall = false,
            android = false,
            epaper = false;
        const androidPlayer = 'Android Player',
            windowsPlayer = 'Windows Player',
            epaperPlayer = 'E-Paper';
        const allScreens = await cmsDb.selectRows({
            query: `SELECT SCREEN_ID FROM CMS_SCREEN_DISTRIBUTION WHERE ID = $1 OR POPUP_ID = $1`,
            values: [id],
        });
        if (allScreens && allScreens.length > 0) {
            for (const screen of allScreens) {
                const { screenId } = screen;
                let playMode;
                if (isScreenwall(screenId) && (!expandedWall || !duplicatedWall)) {
                    playMode = await dmsDb.selectRows({
                        query: `SELECT PLAY_MODE FROM DMS_WALL WHERE SCREEN_ID = $1`,
                        values: [screenId],
                    });
                    if (playMode.length && playMode[0].playMode === 'EXPANDED') {
                        expandedWall = true;
                    } else if (playMode.length && playMode[0].playMode === 'DUPLICATED') {
                        duplicatedWall = true;
                    }
                } else {
                    let screenType = await dmsDb.selectRows({
                        query: `SELECT SCREEN_TYPE FROM DMS_SCREEN WHERE SCREEN_ID = $1`,
                        values: [screenId],
                    });
                    if (Array.isArray(screenType) && screenType.length > 0) {
                        if (screenType[0].screenType === androidPlayer) {
                            android = true;
                        } else if (screenType[0].screenType === windowsPlayer) {
                            windows = true;
                        } else if (screenType[0].screenType === epaperPlayer) {
                            epaper = true;
                        }
                    }
                }

                if (expandedWall && android && windows && epaper && duplicatedWall) {
                    break;
                }
            }
        }
        const publishedInfo = { expandedWall: expandedWall, duplicatedWall: duplicatedWall, android: android, windows: windows, epaper: epaper };
        publishedInfos[index] = publishedInfo;
        return;
    } catch (error) {
        logger.error('[UtilService][getPublishedInfo] ', error);
        throw error;
    }
};

const isScreenwall = (screenId) => {
    return /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(screenId);
};

const checkRateLimit = async (userId, redisService, interval, resetTime, maxReqAllowed, apiName) => {
    let currTime = new Date().getTime();
    let lock;
    try {
        lock = await redisService.lock([`locks:cases-${userId}-${apiName}-count`, `locks:cases-${userId}-${apiName}-isSuspended`], 5000);
        const redisCaseCountResult = await redisService.get(`cases-${userId}-${apiName}-count`);
        const isCasesRequestSuspended = await redisService.get(`cases-${userId}-${apiName}-isSuspended`);
        if (isCasesRequestSuspended == null) {
            if (!redisCaseCountResult || redisCaseCountResult.expirationTime < currTime) {
                let expireDate = new Date();
                expireDate.setMinutes(expireDate.getMinutes() + interval);
                await redisService.set(
                    `cases-${userId}-${apiName}-count`,
                    {
                        count: 1,
                        expirationTime: expireDate.getTime(),
                    },
                    interval * 60,
                );
            } else if (redisCaseCountResult.count < maxReqAllowed && redisCaseCountResult.expirationTime > currTime) {
                await redisService.set(
                    `cases-${userId}-${apiName}-count`,
                    {
                        count: redisCaseCountResult.count + 1,
                        expirationTime: redisCaseCountResult.expirationTime,
                    },
                    (redisCaseCountResult.expirationTime - currTime) / 1000,
                );
            } else {
                if (isCasesRequestSuspended == null) {
                    await redisService.set(`cases-${userId}-${apiName}-isSuspended`, true, resetTime * 60);
                }
                throw handleError('EXCEEDED_ATTEMPT_COUNT', 'Retry count exceeded. Please try after sometime');
            }
            return true;
        } else {
            throw handleError('EXCEEDED_ATTEMPT_COUNT', 'Retry count exceeded. Please try after sometime');
        }
    } catch (e) {
        logger.error('[COMMON][ERROR][checkRateLimit]', e);
        throw e;
    } finally {
        if (lock) {
            await lock.unlock();
        }
    }
};

const getCountryCode = (req) => {
    let countryCode;
    countryCode = req.headers['cloudfront-viewer-country'] || '';
    countryCode = (process.env.NODE_ENV == 'k8s') ? process.env.COUNTRY_CODE : countryCode;
    return countryCode;
};

const UtilService = {
    createUUID,
    StatusCodes,
    isEmpty,
    camelCase,
    clone,
    find,
    filter,
    map,
    forEach,
    includes,
    isArray,
    isNull,
    createNoContentHttpResponse,
    createAcceptedHttpResponse,
    createOKHttpResponse,
    createCreatedHttpResponse,
    createErrorHttpResponse,
    handleError,
    QueryBuilder,
    createHash,
    parseLocaleToUTC,
    replaceString,
    replaceAllString,
    getDeleteCookies,
    createCookieList,
    updateOrderByLastMemory,
    revertOrderByLastMemory,
    getOrderByLastMemory,
    extractCookieValue,
    isTagNameValid,
    isTagValid,
    isValidRegExp,
    miliSecondtoDays,
    adding0ToSingleDigit,
    to12HrsFormat,
    isAllowedChar,
    checkForCreatorOrUpdaterId,
    replaceSpecialCharWithESC,
    replaceApostropheWithESC,
    getBodyFromLambdaPayload,
    getuserName,
    getUserOrganizationRole,
    getSubscriptionsRoleWise,
    getParsedBodyFromEvent,
    customError,
    checkSpecialContent,
    isUsedInPlaylist,
    isUsedInSchedule,
    updatePublishedTime,
    requestedDateQuery,
    isPlanProSeries,
    shareAndPublishedList,
    deleteUserIfOnlyInThisPlace,
    checkForErrorType,
    checkTagsetLock,
    arrayToObjectMap,
    arrayToArrayMap,
    sortForManageableProperty,
    getPaginatedRowsforeachPlanType,
    getDuplicateName,
    findDuplicateName,
    unzipper,
    addResponseHeader,
    queryTagFromUms,
    checkPlacesBelongToOrg,
    isUserExistsInOrganizationByUserId,
    getExtension,
    maskSensitiveNameWithAsterisk,
    convertCookiesToArray,
    isPIRSContent,
    isValidUUID,
    isValidEmail,
    getS3KeyPop,
    extractTokenFromCookie,
    makeShareQuery,
    makeQuery,
    makeSearchQuery,
    getOrderByLastRedis,
    updateOrderByLastRedis,
    revertOrderByLastRedis,
    fetchIndexJSFiles,
    validateAccessToken,
    getSupportedFileExtensions,
    sendRMStatePayloadToSQS,
    isNumeric,
    getEmptyResponse,
    getOpenApiHeaderObject,
    isPlanXSeries,
    setPublished,
    getLifespan,
    getLifespanRelationUser,
    copyLifespan,
    checkJsonError,
    checkScreenType,
    isOwner,
    handlePresetRelation,
    getCountryCodeByCountryName,
    checkPresetData,
    getPublishedInfo,
    checkRateLimit,
    getCountryCode,
};

module.exports = UtilService;

import json
import logging
from typing import Dict, Any, List, Optional
import psycopg2
from psycopg2.extras import RealDictCursor
from datetime import datetime
import re
from urllib.parse import unquote

# Placeholder imports for external services (to be provided)
from secretsmanager_service import SecretsManagerService
from jwt_service import JwtService
from redis_service import RedisService
from database_service import DatabaseService
from samsungaccount_service import SamsungAccountManager
from dynamo_service import DynamoDBService
from deviceauth_service import DeviceAuthService
from resourceAccess_service import checkResourcePermission
from dkms_service import hash
from util_service import validateAccessToken, getCountryCode

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Constants
COMMON_AUTH_TERMS_TTL_IN_SEC = 3600  # Assumed value; replace with actual constant

class AuthenticateService:
    def __init__(self, type: str, region: str, auth_secret_name: Optional[str] = None, ums_secret_name: Optional[str] = None):
        self.type = type
        self.region = region
        self.auth_secret_name = auth_secret_name
        self.ums_secret_name = ums_secret_name
        self.terms_bypass_urls = ['/users', '/thirdparty']
        self.redis_service = None
        self.ums_service = None
        self.device_auth_service = None
        self.samsung_account_manager = None
        self.dynamo_db = None
        self.jwt_service = None
        self.parsed_secret = None

    async def init(self) -> None:
        if not self.redis_service:
            secret_manager = SecretsManagerService(self.auth_secret_name, self.region)
            secret = await secret_manager.get_secrets()
            self.parsed_secret = json.loads(secret)
            redis_host = self.parsed_secret.get('redisHost')
            redis_port = self.parsed_secret.get('redisPort')
            self.redis_service = RedisService(redis_host, redis_port)
        
        if not self.device_auth_service:
            secret_manager = SecretsManagerService(self.auth_secret_name, self.region)
            secret = await secret_manager.get_secrets()
            self.parsed_secret = json.loads(secret)
            screen_auth_redis_host = self.parsed_secret.get('screenAuthRedisHost')
            screen_auth_redis_port = self.parsed_secret.get('screenAuthRedisPort')
            self.device_auth_service = DeviceAuthService(
                params={'type': 'AUTHENTICATION', 'region': self.region, 'screen_auth_host': screen_auth_redis_host, 'screen_auth_port': screen_auth_redis_port}
            )
        
        if not self.ums_service:
            self.ums_service = DatabaseService(
                params={'region': self.region, 'secretManagerName': self.ums_secret_name, 'instanceName': 'ums'}
            )
        
        if not self.samsung_account_manager:
            self.samsung_account = SamsungAccountManager()
        
        if not self.dynamo_db:
            self.dynamo_db = DynamoDBService.get_instance(self.region)
        
        if not self.jwt_service:
            self.jwt_service = JwtService(True)

    async def set_authentication(self, user_id: str, email: str, org_id: str, place_id: str, role_id: str) -> Dict:
        return await self.generate_policy(user_id, email, org_id, place_id, role_id)

    async def generate_policy(self, params: Dict) -> Dict:
        user_id = params.get('userId')
        email = params.get('email')
        org_id = params.get('orgId')
        place_id = params.get('placeId')
        role_id = params.get('roleId')
        
        logger.info(f"[AUTH][{user_id}] generate policy for user", extra={'user_id': user_id, 'email': email, 'org_id': org_id, 'place_id': place_id})
        access_api = await self.dynamo_db.get({
            'TableName': 'fcms-auth-accessApi-dm',
            'Key': {
                'Resource_Name': self.type,
            },
        })
        access_api = access_api['Item']['Resources']
        if not role_id:
            access_control_list = access_api['NONE']
            logger.info('No place and role', extra={'access_control_list': access_control_list})
        else:
            access_control_list = access_api[role_id.upper()]
        
        for arr in access_control_list.values():
            for i, value in enumerate(arr):
                arr[i] = value.replace('${orgId}', org_id).replace('${wId}', place_id).replace('${userId}', user_id).replace('${email}', email)
        
        return access_control_list

    async def verify_device_token(self, device_token: str) -> None:
        decode = self.jwt_service.decoded(device_token)
        id = decode.get('id')
        module = decode.get('client')
        client = 'PLAYER' if module == 'PLAYER' else 'RM'
        logger.info(f"[AUTH][devicetoken][{client}][{id}]")
        result = await self.device_auth_service.verify(device_token, 'DISPLAY', id, client)
        if not result:
            raise Exception('Unauthorized')

    async def verify_system_token(self, token: str) -> None:
        decode = self.jwt_service.decoded(token)
        hmac_from_header = decode.get('hmac')
        system_token = await self.redis_service.get(token)
        hmac_from_redis = system_token.get('hmac')
        if hmac_from_header != hmac_from_redis:
            raise Exception('Unauthorized')

    def update_terms_bypass_urls(self, new_skip_urls: List[str]) -> None:
        self.terms_bypass_urls.extend(new_skip_urls)

    async def verify_user_terms(self, user_id: str, country_code: str) -> bool:
        try:
            country_code = country_code.upper()
            logger.info(f"[VERIFY TERMS][userId = {user_id}][countryCode = {country_code}]")
            agreement_query = """
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
                (TERM_REGION = %s OR TERM_REGION = 'Common' OR TERM_REGION = 'Default') AND
                IS_MANDATORY = TRUE
            )
            SELECT
                lt.TERM_ID,
                lt.TERM_VERSION
            FROM
                LatestTerms lt
            LEFT JOIN UMS_USER_TERM_AGREEMENT uta
                ON lt.TERM_ID = uta.TERM_ID AND uta.USER_ID = %s
            WHERE
                lt.RN = 1 AND (TERM_REGION = %s OR TERM_REGION = 'Common') AND (uta.IS_AGREED IS NULL OR uta.IS_AGREED = FALSE)
            
            UNION ALL
            
            SELECT
                ltd.TERM_ID,
                ltd.TERM_VERSION
            FROM
                LatestTerms ltd
            LEFT JOIN UMS_USER_TERM_AGREEMENT uta
                ON ltd.TERM_ID = uta.TERM_ID AND uta.USER_ID = %s
            WHERE
                ltd.RN = 1 AND TERM_REGION = 'Default' AND (uta.IS_AGREED IS NULL OR uta.IS_AGREED = FALSE) AND
                NOT EXISTS (
                    SELECT 1
                    FROM UMS_TERM ut
                    WHERE ut.TERM_TYPE = ltd.TERM_TYPE AND ut.TERM_REGION = %s
                )
            """
            agreement_needed = await self.ums_service.select_rows({
                'query': agreement_query,
                'values': [country_code, user_id, country_code, user_id, country_code],
            })
            if agreement_needed and len(agreement_needed) > 0:
                logger.info('[AGREEMENT REQUIRED]', extra={'agreement_needed': agreement_needed})
                return False
            now = int(datetime.now().timestamp() * 1000)
            await self.redis_service.set(
                f"commonAuth-user-terms:{user_id}",
                {'updatedTime': now},
                COMMON_AUTH_TERMS_TTL_IN_SEC
            )
        except Exception as e:
            logger.error(str(e), exc_info=True)
        return True

    async def authenticate(self, req: Dict, res: Dict) -> Dict:
        await self.init()
        original_url = req.get('originalUrl')
        method = req.get('method')
        params = req.get('params', {}).copy()
        token = req.get('cookies', {}).get('token')
        authorization = req.get('headers', {}).get('authorization')
        open_api_token = req.get('headers', {}).get('openapitoken')
        device_token = req.get('headers', {}).get('devicetoken')
        current_time = datetime.now().isoformat()
        access_log_string = f"[{current_time}][{method}] {original_url}"
        logger.info(f"{access_log_string} begin.....")
        
        role_changed_data = None
        try:
            if open_api_token is not None:
                logger.info('[OpenApiRequest]')
                open_api_org = req.get('headers', {}).get('organizationId')
                open_api_app = req.get('headers', {}).get('appId')
                if not open_api_org or not open_api_app:
                    logger.error('[ERROR]: Missing Organization Id or App Id in header')
                    raise Exception('Unauthorized')
                redis_open_api_key = f"OpenApi_{open_api_org}_{open_api_app}"
                token_from_redis = await self.redis_service.get(redis_open_api_key)
                if not token_from_redis or token_from_redis != open_api_token:
                    logger.error('[ERROR]: OpenAPI token mismatch or not found')
                    raise Exception('Unauthorized')
                return res
            if device_token:
                await self.verify_device_token(device_token)
                return res
            elif token or authorization:
                key = authorization or token
                decode = self.jwt_service.decoded(key)
                if decode:
                    token_type = decode.get('tokenType')
                    if token_type == 'ds':
                        await self.verify_device_token(key)
                        return res
                    elif token_type == 'system':
                        await self.verify_system_token(key)
                        return res
                    account = decode.get('account', {})
                    decode_user_name = account.get('userName')
                    decoded_user_id = account.get('userId')
                    email = account.get('email')
                    org = decode.get('organizations', [])
                    user_info = decode.get('userInfo', {})
                    picture = user_info.get('picture')
                    last_place = decode.get('lastPlace', {})
                    place_id = last_place.get('placeId')
                    role_id = last_place.get('roleId')
                    exp = decode.get('exp')
                    token_type = decode.get('tokenType')
                    iat = decode.get('iat', False)
                    organization_id = org[0].get('organizationId') if org and len(org) > 0 else None
                    sa_token = await self.redis_service.get(key)
                    if not sa_token:
                        logger.info(f"[{decoded_user_id}] token was expired")
                        raise Exception('Unauthorized')
                    try:
                        sa_token_valid = await self.redis_service.get(f"{sa_token}__valid")
                        if not sa_token_valid or not sa_token_valid.get('isValid'):
                            is_valid = await validateAccessToken(sa_token, self.parsed_secret, token)
                            logger.info(f"isValid - FROM Samsung Account {is_valid}")
                            if not is_valid:
                                raise Exception('Unauthorized')
                            await self.redis_service.set(
                                f"{sa_token}__valid", {'isValid': is_valid}, 60 * 30
                            )
                    except Exception as e:
                        logger.error(str(e), exc_info=True)
                        raise
                    valid_user = await self.ums_service.select_rows({
                        'query': "SELECT 1 FROM UMS_USER WHERE USER_ID = %s AND USER_STATUS = %s",
                        'values': [decoded_user_id, 'registered'],
                    })
                    if valid_user and len(valid_user) == 1 and not any(url in original_url for url in self.terms_bypass_urls):
                        user_terms_verified = await self.redis_service.get(f"commonAuth-user-terms:{decoded_user_id}") or {}
                        country_code = getCountryCode(req)
                        if not user_terms_verified:
                            if not await self.verify_user_terms(decoded_user_id, country_code):
                                raise Exception('MISSING_MANDATORY_AGREEMENTS')
                    access_control_list = []
                    access_control_list_mismatch = []
                    place_users_request = []
                    auth_result_mismatch = False
                    generate_policy_mismatch = False
                    if token_type == 'admin':
                        logger.info('Get ACL for admin-hub')
                        access_control_list = {
                            'GET': [r'/api/ums/(.*)', r'/customsso/(.*)'],
                            'DELETE': [r'/api/ums/admin/(.*)', r'/customsso/(.*)'],
                            'POST': [r'/api/ums/admin/(.*)', r'/customsso/(.*)'],
                            'PUT': [r'/api/ums/admin/(.*)', r'/customsso/(.*)'],
                        }
                        auth_result = any(
                            re.match(api, original_url.split('?')[0])
                            for api in access_control_list.get(method.upper(), [])
                        )
                        if not auth_result:
                            raise Exception('Forbidden')
                        return res
                    else:
                        logger.info('Get ACL for normal user')
                        org_users = await self.ums_service.select_rows({
                            'query': "SELECT ROLE_ID FROM UMS_ORGANIZATION_RELATION_USER WHERE USER_ID = %s AND ORGANIZATION_ID = %s",
                            'values': [decoded_user_id, organization_id],
                        })
                        if not org_users or len(org_users) <= 0:
                            raise Exception('USER_WITHDRAW')
                        elif org_users[0].get('roleId') != org[0].get('roleId'):
                            raise Exception('ROLE_CHANGED')
                        if org_users[0].get('roleId') != 'ROLE_OWNER' and not place_id:
                            raise Exception('USER_NO_ASSIGNED_PLACE')
                        if org_users[0].get('roleId') != 'ROLE_OWNER' and place_id:
                            place_users = await self.ums_service.select_rows({
                                'query': "SELECT ROLE_ID FROM UMS_PLACE_RELATION_USER WHERE USER_ID = %s AND PLACE_ID = %s",
                                'values': [decoded_user_id, place_id],
                            })
                            if place_users and len(place_users) > 0:
                                if place_users[0].get('roleId') != role_id:
                                    role_changed_data = {
                                        'old': role_id,
                                        'new': place_users[0].get('roleId'),
                                    }
                                    raise Exception('ROLE_CHANGED')
                            else:
                                place_users_change_check = await self.ums_service.select_rows({
                                    'query': "SELECT ROLE_ID, PLACE_ID FROM UMS_PLACE_RELATION_USER WHERE USER_ID = %s",
                                    'values': [decoded_user_id],
                                })
                                if place_users_change_check and len(place_users_change_check) > 0:
                                    place_id = place_users_change_check[0].get('placeId')
                                    role_id = place_users_change_check[0].get('roleId')
                                else:
                                    raise Exception('USER_NO_ASSIGNED_PLACE')
                        if params.get('placeId') and place_id and params.get('placeId') != place_id:
                            place_users_request = await self.ums_service.select_rows({
                                'query': "SELECT ROLE_ID FROM UMS_PLACE_RELATION_USER WHERE USER_ID = %s AND PLACE_ID = %s",
                                'values': [decoded_user_id, params.get('placeId')],
                            })
                            place_users_org_request = await self.ums_service.select_rows({
                                'query': "SELECT PLACE_ID FROM UMS_ORGANIZATION_RELATION_PLACE WHERE ORGANIZATION_ID = %s AND PLACE_ID = %s",
                                'values': [organization_id, params.get('placeId')],
                            })
                            if (org_users[0].get('roleId') == 'ROLE_OWNER' and place_users_org_request) or (place_users_request and len(place_users_request) > 0):
                                generate_policy_mismatch = True
                        if 'organizationId' in params and 'placeId' in params and 'id' in params:
                            resource_permission_obj = {
                                'orgId': params.get('organizationId'),
                                'placeIdList': [params.get('placeId')],
                                'resourceId': params.get('id'),
                                'accessList': [],
                                'resourceUri': original_url,
                                'userId': decoded_user_id,
                            }
                            is_allowed_on_resource = await checkResourcePermission(resource_permission_obj)
                            if not is_allowed_on_resource:
                                raise Exception('Forbidden')
                        if generate_policy_mismatch:
                            access_control_list_mismatch = await self.redis_service.get(f"{self.type}{iat}{params.get('placeId')}{key}__acl")
                            if not access_control_list_mismatch:
                                access_control_list_mismatch = await self.set_authentication(
                                    decoded_user_id, email, organization_id,
                                    params.get('placeId'),
                                    'ROLE_OWNER' if org_users[0].get('roleId') == 'ROLE_OWNER' else place_users_request[0].get('roleId')
                                )
                                await self.redis_service.set(
                                    f"{self.type}{iat}{params.get('placeId')}{key}__acl",
                                    access_control_list_mismatch,
                                    exp - int(datetime.now().timestamp())
                                )
                            auth_result_mismatch = any(
                                re.match(api, original_url.split('?')[0])
                                for api in access_control_list_mismatch.get(method.upper(), [])
                            )
                            if not auth_result_mismatch:
                                raise Exception('Forbidden')
                        access_control_list = await self.redis_service.get(f"{self.type}{iat}{decoded_user_id}{key}__acl")
                        if not access_control_list:
                            access_control_list = await self.set_authentication(
                                decoded_user_id, email, organization_id, place_id, role_id
                            )
                            await self.redis_service.set(
                                f"{self.type}{iat}{decoded_user_id}{key}__acl",
                                access_control_list,
                                exp - int(datetime.now().timestamp())
                            )
                    auth_result = any(
                        re.match(api, original_url.split('?')[0])
                        for api in access_control_list.get(method.upper(), [])
                    )
                    if not auth_result and not auth_result_mismatch:
                        raise Exception('Forbidden')
                    if self.type == 'UMS':
                        user_email_hash = await hash(email, 'email')
                        await self.ums_service.update_row({
                            'table': 'UMS_USER',
                            'columnsValues': {
                                'LAST_ACTIVITY_TIME': 'NOW()',
                            },
                            'wheres': {
                                'EMAIL_HASH': user_email_hash,
                            },
                            'returning': '*',
                        })
                    user_context = {
                        'userName': unquote(decode_user_name),
                        'userEmail': email,
                        'organization': org[0] if org and len(org) > 0 else {},
                        'userId': decoded_user_id,
                        'userPicture': picture,
                    }
                    req['userContext'] = user_context
                else:
                    raise Exception('jwt is wrong')
                return res
            else:
                raise Exception('there is no token')
        except Exception as e:
            logger.info(f"[ERROR] {str(e)}", exc_info=True)
            logger.error(str(e), exc_info=True)
            error_response = {
                'resultMessage': str(e),
            }
            if str(e) == 'Forbidden':
                error_response['resultCode'] = 403
                return {'statusCode': 403, 'body': json.dumps(error_response)}
            elif str(e) == 'MISSING_MANDATORY_AGREEMENTS':
                error_response['resultCode'] = 70001
                error_response['resultMessage'] = 'Missing mandatory agreements'
                return {'statusCode': 403, 'body': json.dumps(error_response)}
            elif str(e) == 'USER_WITHDRAW':
                error_response['resultCode'] = 40401
                error_response['resultMessage'] = 'User withdrawal'
                return {'statusCode': 401, 'body': json.dumps(error_response)}
            elif str(e) == 'ROLE_CHANGED':
                error_response['resultCode'] = 40104
                error_response['resultMessage'] = "User's role is changed."
                if role_changed_data and 'old' in role_changed_data and 'new' in role_changed_data:
                    error_response['data'] = role_changed_data
                return {'statusCode': 401, 'body': json.dumps(error_response)}
            elif str(e) == 'Unauthorized':
                error_response['resultCode'] = 401
                return {'statusCode': 401, 'body': json.dumps(error_response)}
            elif str(e) == 'USER_NO_ASSIGNED_PLACE':
                error_response['resultCode'] = 200
                error_response['places'] = []
                return {'statusCode': 200, 'body': json.dumps(error_response)}
            else:
                logger.info('Unknown error')
                error_response['resultCode'] = 401
                return {'statusCode': 401, 'body': json.dumps(error_response)}
        finally:
            logger.info(f"{access_log_string} end")

# Lambda Handler
def lambda_handler(event: Dict, context: Any) -> Dict:
    """
    AWS Lambda handler to route authentication service operations.
    
    Expected event structure:
    {
        "operation": "setAuthentication|verifyDeviceToken|verifySystemToken|verifyUserTerms|authenticate",
        "params": {
            // For setAuthentication
            "userId": str,
            "email": str,
            "orgId": str,
            "placeId": str,
            "roleId": str,
            // For verifyDeviceToken
            "deviceToken": str,
            // For verifySystemToken
            "token": str,
            // For verifyUserTerms
            "userId": str,
            "countryCode": str,
            // For authenticate
            "req": {
                "originalUrl": str,
                "method": str,
                "params": dict,
                "cookies": dict,
                "headers": dict
            }
        }
    }
    """
    auth_service = None
    try:
        type = event.get('type', 'UMS')
        region = event.get('region', 'us-east-1')
        auth_secret_name = event.get('authSecretName')
        ums_secret_name = event.get('umsSecretName')
        auth_service = AuthenticateService(type, region, auth_secret_name, ums_secret_name)
        operation = event.get('operation')
        params = event.get('params', {})
        
        if not operation:
            raise Exception('INVALID_OPERATION: Operation not specified in event')
        
        if operation == 'setAuthentication':
            result = await auth_service.set_authentication(
                params.get('userId'), params.get('email'), params.get('orgId'),
                params.get('placeId'), params.get('roleId')
            )
        elif operation == 'verifyDeviceToken':
            result = await auth_service.verify_device_token(params.get('deviceToken'))
        elif operation == 'verifySystemToken':
            result = await auth_service.verify_system_token(params.get('token'))
        elif operation == 'verifyUserTerms':
            result = await auth_service.verify_user_terms(
                params.get('userId'), params.get('countryCode')
            )
        elif operation == 'authenticate':
            req = params.get('req', {})
            res = {'statusCode': 200, 'body': json.dumps({'message': 'Authenticated'})}
            result = await auth_service.authenticate(req, res)
        else:
            raise Exception(f"INVALID_OPERATION: Operation {operation} not supported")
        
        return result if operation == 'authenticate' else {
            'statusCode': 200,
            'body': json.dumps({'result': result}, default=str)
        }
    
    except Exception as e:
        logger.error(f"Lambda handler error: {str(e)}", exc_info=True)
        return {
            'statusCode': 500,
            'body': json.dumps({'error': str(e)})
        }

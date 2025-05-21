import json
import logging
import uuid
import re
from typing import Dict, List, Any, Optional
import psycopg2
from psycopg2.extras import RealDictCursor
from datetime import datetime
import boto3
import redis
from email_validator import validate_email, EmailNotValidError
from pathlib import Path
import jwt
import os

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Database connection configuration (replace with your DB details)
def get_db_connection():
    return psycopg2.connect(
        dbname="your_db",
        user="your_user",
        password="your_password",
        host="your_host",
        port="your_port",
        cursor_factory=RealDictCursor
    )

# Redis connection configuration (replace with your Redis details)
def get_redis_connection():
    return redis.Redis(
        host="your_redis_host",
        port=6379,
        password="your_redis_password",
        decode_responses=True
    )

# Utility function for error handling
def handle_error(error_code: str, message: str) -> Exception:
    return Exception(f"{error_code}: {message}")

async def delete_user_if_only_in_this_place(params: Dict) -> None:
    users_to_delete = params.get('usersToDelete', [])
    place_ids = params.get('placeIds', [])
    region = params.get('region')
    organization_id = params.get('organizationId')
    cookies = params.get('cookies', {})
    
    try:
        payload = {
            'queryStringParameters': {'isPlaceDeleted': True},
            'body': {'userIds': users_to_delete, 'placeIds': place_ids},
            'cookies': cookies,
            'pathParameters': {'organizationId': organization_id}
        }
        lambda_client = boto3.client('lambda', region_name=region)
        lambda_client.invoke(
            FunctionName='DELETE_USERS',
            InvocationType='Event',
            Payload=json.dumps(payload)
        )
    except Exception as e:
        logger.error(f"[USERS DELETE] Failed: {str(e)}")
        raise

async def check_tagset_lock(tagset_id: str, db: Any) -> None:
    try:
        with db.cursor() as cur:
            cur.execute("SELECT IS_LOCK FROM AMS_TAGSET WHERE TAGSET_ID = %s", (tagset_id,))
            tagset = cur.fetchall()
        if tagset and tagset[0].get('is_lock'):
            raise handle_error('LOCKED', "The tagset is locked. You can't modify it.")
    except Exception as e:
        logger.error(f"[CHECK TAGSET LOCK] Failed: {str(e)}")
        raise

def get_duplicate_name(content_list: List[Dict], original_name: str, content_type: str) -> str:
    hash_array = [-1] * (len(content_list) + 2)
    original_name_length = len(original_name)
    
    for item in content_list:
        current_name = (
            item.get('contentName') if content_type == 'CONTENT' else
            item.get('playlistName') if content_type == 'PLAYLIST' else
            item.get('programName') if content_type == 'PROGRAM' else ''
        )
        if current_name:
            start_idx = current_name.find('(', original_name_length)
            end_idx = current_name.find(')', original_name_length)
            if start_idx != -1 and end_idx != -1:
                try:
                    duplication_number = int(current_name[start_idx + 1:end_idx])
                    if duplication_number <= len(content_list):
                        hash_array[duplication_number] = 1
                except ValueError:
                    pass
    
    for i in range(1, len(hash_array)):
        if hash_array[i] == -1:
            return f"{original_name} ({i})"
    return original_name

async def find_duplicate_name(
    file_name: str, table_name: str, column_name: str, organization_id: str,
    place_id: str, db_instance: Any, conn: Any, caller_name: str
) -> str:
    if not db_instance:
        raise handle_error('INTERNAL_SERVER_ERROR', 'Database Object Not Defined')
    
    new_file_name = f"{file_name}____%"
    logger.info(f"[{caller_name.upper()}][newFileName]: {new_file_name}")
    
    try:
        with (conn.cursor() if conn else db_instance.cursor()) as cur:
            cur.execute(
                f"SELECT * FROM {table_name} WHERE {column_name} LIKE %s AND ORGANIZATION_ID = %s "
                f"AND PLACE_ID = %s AND IS_DELETED = 'FALSE' ORDER BY {column_name} ASC",
                (new_file_name, organization_id, place_id)
            )
            result = cur.fetchall()
        logger.info(f"result length: {len(result)}")
        logger.info(f"result: {result}")
        return get_duplicate_name(result, file_name, caller_name)
    except Exception as e:
        logger.error(f"[FIND DUPLICATE NAME] Failed: {str(e)}")
        raise handle_error('INTERNAL_SERVER_ERROR', f"Failed to get duplicate {caller_name.upper()} name")

def add_response_header(key: str, value: str, ori_headers: Optional[Dict] = None) -> Dict:
    headers = ori_headers.copy() if ori_headers else {}
    headers[key] = value
    return headers

async def is_user_exists_in_organization_by_user_id(org_id: str, user_id: str, db: Any) -> bool:
    try:
        with db.cursor() as cur:
            cur.execute(
                "SELECT ORGANIZATION_ID FROM UMS_ORGANIZATION_RELATION_USER WHERE USER_ID = %s",
                (user_id,)
            )
            user_org_id = cur.fetchall()
        if not user_org_id:
            raise Exception('User is not in any organization')
        return user_org_id[0].get('organization_id') == org_id
    except Exception as e:
        logger.error(f"[IS USER EXISTS] Failed: {str(e)}")
        raise

def get_extension(filename: str) -> str:
    return filename.rsplit('.', 1)[-1].lower() if '.' in filename else ''

def mask_sensitive_name_with_asterisk(name: str) -> str:
    return re.sub(r'(?<!^).(?!$)', '*', name)

async def is_pirs_content(media_type: str, type: str = '') -> bool:
    return media_type == 'VX' and type in ['ART', 'CDNG', 'RENG', 'LPWI']

async def is_valid_uuid(uuid_str: str, param: str = 'UUID') -> bool:
    try:
        uuid.UUID(uuid_str)
        return True
    except ValueError:
        raise handle_error('INVALID_PARAMETER_VALUE', f"Please enter valid {param}")

async def is_valid_email(email_id: str) -> bool:
    try:
        validate_email(email_id)
        return True
    except EmailNotValidError:
        raise handle_error('INVALID_PARAMETER_VALUE', f"{email_id} is invalid email")

async def get_s3_key_pop(organization_id: str, place_id: str, pop_id: str, db: Any) -> str:
    try:
        with db.cursor() as cur:
            cur.execute(
                "SELECT START_DATE, END_DATE FROM UMS_POP_EXPORT WHERE PLACE_ID = %s "
                "AND ORGANIZATION_ID = %s AND POP_EXPORT_ID = %s",
                (place_id, organization_id, pop_id)
            )
            data = cur.fetchall()
        if not data:
            raise Exception("No data found for POP export")
        
        start_date = data[0]['start_date']
        end_date = data[0]['end_date']
        start_str = start_date.strftime('%Y-%m-%d')
        end_str = end_date.strftime('%Y-%m-%d')
        return f"organization/{organization_id}/{place_id}/pop/{pop_id}_{start_str}_{end_str}.zip"
    except Exception as e:
        logger.error(f"[GET S3 KEY POP] Failed: {str(e)}")
        raise

async def extract_token_from_cookie(headers: Dict) -> str:
    cookie = headers.get('cookie')
    if not cookie:
        logger.info('[ERROR] there is no cookie')
        raise Exception('Forbidden')
    
    token_match = re.search(r'(?<!_)token=([^;]*)', cookie)
    if token_match:
        return token_match.group(1)
    logger.info('[ERROR] there is no token in cookie')
    raise Exception('Forbidden')

def make_query(name: str, array: List, case_type: str, operator: str = 'AND', type_operator: Optional[str] = None) -> Dict:
    if operator not in ['AND', 'OR']:
        raise Exception(f"Invalid Operator: {operator}")
    if type_operator and type_operator not in ['AND', 'OR']:
        raise Exception(f"Invalid Type Operator: {type_operator}")
    
    type_operator = type_operator or operator
    if not array:
        return {'query': '', 'values': []}
    
    values = [v.lower() if case_type == 'lower' else v.upper() for v in array]
    query = f" {operator} ({' '.join(f'{name} = %s {type_operator if i < len(array) - 1 else ''}' for i in range(len(array)))})"
    return {'query': query, 'values': values}

def make_share_query(array: List, operator: str = 'AND') -> Dict:
    if operator not in ['AND', 'OR']:
        raise Exception(f"Invalid Operator: {operator}")
    if not array:
        return {'query': ''}
    
    query_parts = []
    for i, a in enumerate(array):
        if a == 'shared':
            query_parts.append("(A.IS_SHARED = TRUE AND D.SHARED IS NULL)")
        elif a == 'notShared':
            query_parts.append("(A.IS_SHARED = FALSE)")
        elif a == 'sharedByOthers':
            query_parts.append("(D.SHARED = TRUE)")
        if i < len(array) - 1:
            query_parts.append(operator)
    
    query = f" {operator} ({' '.join(query_parts)})"
    return {'query': query}

def make_search_query(name: str, array: List, operator: str = 'AND', operator_inner: Optional[str] = None) -> Dict:
    if operator not in ['AND', 'OR']:
        raise Exception(f"Invalid Operator: {operator}")
    operator_inner = operator_inner or operator
    if not array:
        return {'query': '', 'values': []}
    
    values = [f"%{v.upper()}%" for v in array]
    query = f" {operator} ({' '.join(f'UPPER({name}) LIKE %s {operator_inner if i < len(array) - 1 else ''}' for i in range(len(array)))})"
    return {'query': query, 'values': values}

async def get_order_by_last_redis(order_by: str, order: str, user_id: str, update_key: str, redis_service: Any) -> Dict:
    try:
        redis_data = redis_service.get(f"order:{user_id}:{update_key}")
        if redis_data:
            redis_data = json.loads(redis_data)
            if redis_data.get('lastOrderBy') and redis_data.get('lastOrder'):
                return {'lastOrderBy': redis_data['lastOrderBy'], 'lastOrder': redis_data['lastOrder']}
        return {'lastOrderBy': 'updated_time', 'lastOrder': 'desc'}
    except Exception as e:
        logger.error(f"[COMMON][ERROR][getOrderByLastRedis]: {str(e)}")
        return {'lastOrderBy': order_by, 'lastOrder': order}

async def update_order_by_last_redis(order_by: str, order: str, user_id: str, update_key: str, redis_service: Any) -> Dict:
    try:
        if order_by != 'default':
            redis_service.setex(
                f"order:{user_id}:{update_key}",
                30 * 24 * 60 * 60,
                json.dumps({'lastOrderBy': order_by, 'lastOrder': order})
            )
            return {'newOrderBy': order_by, 'newOrder': order}
        
        redis_data = redis_service.get(f"order:{user_id}:{update_key}")
        if redis_data:
            redis_data = json.loads(redis_data)
            if redis_data.get('lastOrderBy') and redis_data.get('lastOrder'):
                return {'newOrderBy': redis_data['lastOrderBy'], 'newOrder': redis_data['lastOrder']}
        
        return {'newOrderBy': 'updated_time', 'newOrder': 'desc'}
    except Exception as e:
        logger.error(f"[COMMON][ERROR][updateOrderByLastRedis]: {str(e)}")
        return {'newOrderBy': order_by, 'newOrder': order}

async def revert_order_by_last_redis(order_by: str, order: str, user_id: str, update_key: str, redis_service: Any) -> None:
    try:
        redis_service.setex(
            f"order:{user_id}:{update_key}",
            30 * 24 * 60 * 60,
            json.dumps({'lastOrderBy': order_by, 'lastOrder': order})
        )
    except Exception as e:
        logger.error(f"[COMMON][ERROR][revertOrderByLastRedis]: {str(e)}")
        raise

async def fetch_index_js_files(directory_path: str, service_name: str) -> List[str]:
    files_array = []
    try:
        for path in Path(directory_path).rglob('index.js'):
            with open(path, 'r', encoding='utf-8') as f:
                if service_name in f.read():
                    files_array.append(str(path))
    except Exception as e:
        logger.error(f"[FETCH INDEX JS FILES] Failed: {str(e)}")
        raise
    return files_array

async def validate_access_token(sa_token: str, parsed_secret: Dict, token: str) -> bool:
    user_jwt = await get_user_jwt(token)
    if user_jwt and user_jwt.get('isCustomSso'):
        return True
    
    # Placeholder for SamsungAccountManager (implement actual logic)
    try:
        # Assuming SamsungAccountManager is a custom class; replace with actual implementation
        return True  # Mocked response
    except Exception as e:
        logger.error(f"[VALIDATE ACCESS TOKEN] Failed: {str(e)}")
        raise

async def get_user_jwt(token: str) -> Optional[Dict]:
    try:
        decoded = jwt.decode(token, options={"verify_signature": False})
        if decoded and 'account' in decoded:
            return decoded
        return None
    except Exception as e:
        logger.error(f"[ERROR] parse user JWT: {str(e)}")
        return None

def get_supported_file_extensions() -> Dict:
    return {
        'image': ['BMP', 'JPG', 'JPEG', 'PNG', 'GIF'],
        'video': ['ASF', 'AVI', 'FLV', 'MKV', 'MOV', 'MPEG', 'MPG', 'MP4', 'MTS', 'M2TS', 'VOB', 'VRO', 'WMV', 'SVI', 'TP', 'TRP', 'TS', '3GP'],
        'sound': ['MP3'],
        'font': ['TTF', 'OTF', 'WOFF', 'WOFF2'],
        'html': ['ZIP'],
        'vx': ['VX'],
        'networkCertificate': ['der', 'pem', 'cer', 'p12', 'pfx'],
        'appCertificate': ['der', 'pem', 'cer', 'crt', 'key'],
        'office': ['DOC', 'DOCX', 'XLS', 'XLSX', 'PPT', 'PPTX', 'PDF', 'PPS']
    }

async def send_rm_state_payload_to_sqs(redis_service: Any, sqs_service: Any, notification_sqs: str, body: Dict) -> None:
    try:
        notification = body.get('notification', {})
        is_retry = body.get('isRetry')
        if notification and notification.get('messageId') is not None:
            key = f"{notification['messageId']}-notification{'-retry' if is_retry else ''}"
            redis_service.setex(key, 7 * 24 * 60 * 60 + 3600, json.dumps(body))
            
            data = {
                'payload': {'messageId': notification['messageId'], 'isRetry': bool(is_retry)},
                'createdTime': int(datetime.now().timestamp() * 1000)
            }
            
            params = {
                'MessageBody': json.dumps({'type': 'RM-NOTIFICATION-PAYLOAD', 'data': data}),
                'QueueUrl': notification_sqs,
                'MessageGroupId': 'default-group'
            }
            logger.info(f"sending to notification sqs: {json.dumps(params)}")
            sqs_service.send_message(**params)
    except Exception as e:
        logger.error(f"[SEND RM STATE PAYLOAD] Failed: {str(e)}")
        raise

def is_numeric(value: str) -> bool:
    return bool(re.match(r'^-?\d+$', str(value)))

def get_empty_response(start: int, rows_per_page: int) -> Dict:
    return {
        'rows': [],
        'total': 0,
        'start': start,
        'rowsPerPage': rows_per_page,
        'hasMore': False
    }

def get_open_api_header_object(event: Dict) -> Dict:
    headers = event.get('headers', {})
    if headers.get('openapitoken'):
        return {
            'openapitoken': headers['openapitoken'],
            'organizationid': headers.get('organizationid'),
            'appid': headers.get('appid')
        }
    return {}

async def is_plan_x_series(place_id: str, ums_db: Any, organization_id: str) -> bool:
    try:
        plan_x_series = ['VX-CXY', 'VX-CXM']
        wheres = [
            ('AND SMC.IS_PRIMARY = TRUE', []),
            (f"AND SMC.MODEL_CODE IN ({','.join(f'%s' for _ in plan_x_series)})", plan_x_series),
            ('AND S.EXPIRATION_DONE = FALSE', [])
        ]
        if place_id:
            wheres.insert(0, ('AND PRS.PLACE_ID = %s', [place_id]))
        if organization_id:
            wheres.insert(0, ('AND S.ORGANIZATION_ID = %s', [organization_id]))
        
        query = (
            "SELECT PRS.PLACE_ID, S.SUBSCRIPTION_ID, S.MODEL_CODE, S.EXPIRATION_DONE, SM.PRO_TRIAL, "
            "SMC.IS_PRIMARY, SMC.PLAN_TYPE "
            "FROM UMS_PLACE_RELATION_SUBSCRIPTION PRS "
            "LEFT JOIN UMS_SUBSCRIPTION S ON S.SUBSCRIPTION_ID = PRS.SUBSCRIPTION_ID "
            "LEFT JOIN UMS_SUBSCRIPTION_META SM ON SM.SUBSCRIPTION_ID = S.SUBSCRIPTION_ID "
            "LEFT JOIN UMS_SUBSCRIPTION_MODEL_CODE SMC ON SMC.MODEL_CODE = S.MODEL_CODE "
            f"WHERE 1=1 {' '.join(w[0] for w in wheres)}"
        )
        values = [v for w in wheres for v in w[1]]
        
        with ums_db.cursor() as cur:
            cur.execute(query, values)
            result = cur.fetchall()
        
        logger.info(f"[COMMON][util][isPlanXSeries={result}]")
        return len(result) > 0
    except Exception as e:
        logger.error(f"[IS PLAN X SERIES] Failed: {str(e)}")
        raise

def set_published(rows: List[Dict]) -> None:
    for row in rows:
        row['published'] = row.get('sharedPublished', row.get('published'))

async def get_lifespan(content: Dict, user_id: str, role: str, db: Any) -> Dict:
    content['lifespan'] = {}
    content_id = content.get('contentId')
    rows = await get_lifespan_query(content_id, db)
    
    if rows:
        content['lifespan'] = rows[0]
        if content['lifespan'].get('start_time') and content['lifespan'].get('start_time_offset'):
            content['lifespan']['startEpochTime'] = int(content['lifespan']['start_time'].timestamp() * 1000)
            content['lifespan']['start_time'] = convert_lifespan_time(
                content['lifespan']['start_time'], content['lifespan']['start_time_offset']
            )
        if content['lifespan'].get('end_time') and content['lifespan'].get('end_time_offset'):
            content['lifespan']['endEpochTime'] = int(content['lifespan']['end_time'].timestamp() * 1000)
            content['lifespan']['end_time'] = convert_lifespan_time(
                content['lifespan']['end_time'], content['lifespan']['end_time_offset']
            )
        
        logger.info(f"[COMMON][util][getLifespan][lifespan={json.dumps(content['lifespan'])}]")
        await set_embargo_thumbnail(content, user_id, role, db)
    
    return content

def convert_lifespan_time(time: datetime, offset: str) -> str:
    utc_time = int(time.timestamp() * 1000) + time.utcoffset().total_seconds() * 1000
    offset_hour, offset_minute = map(int, offset.split(':'))
    if offset_hour < 0:
        offset_minute = -offset_minute
    
    custom_time = utc_time + (offset_hour * 3600 + offset_minute * 60) * 1000
    custom_date = datetime.fromtimestamp(custom_time / 1000)
    return custom_date.strftime('%Y-%m-%dT%H:%M:00')

async def set_embargo_thumbnail(content: Dict, user_id: str, role: str, db: Any) -> None:
    content['embargoThumbnail'] = False
    if content.get('lifespan', {}).get('embargo'):
        if content['lifespan'].get('startEpochTime', 0) > int(datetime.now().timestamp() * 1000):
            content['embargoThumbnail'] = True
            if role != 'ROLE_OWNER':
                relation_users = await get_lifespan_relation_user(content['contentId'], db)
                if not any(ru['user_id'] == user_id for ru in relation_users):
                    content['thumbnailId'] = 'embargo'

async def get_lifespan_query(content_id: str, db: Any) -> List[Dict]:
    query = (
        "SELECT START_TIME, END_TIME, START_TIME_OFFSET, END_TIME_OFFSET, AUTO_DELETE, EMBARGO "
        "FROM CMS_CONTENT_LIFESPAN WHERE CONTENT_ID = %s"
    )
    try:
        with db.cursor() as cur:
            cur.execute(query, (content_id,))
            rowdata = cur.fetchall()
        logger.info(f"getLifespanQuery API response: {json.dumps(rowdata)}")
        return rowdata
    except Exception as e:
        logger.error(f"[GET LIFESPAN QUERY] Failed: {str(e)}")
        raise

async def get_lifespan_relation_user(content_id: str, db: Any) -> List[Dict]:
    query = "SELECT USER_ID FROM CMS_CONTENT_LIFESPAN_RELATION_USER WHERE CONTENT_ID = %s"
    try:
        with db.cursor() as cur:
            cur.execute(query, (content_id,))
            rowdata = cur.fetchall()
        logger.info(f"getLifespanRelationUser API response: {json.dumps(rowdata)}")
        return rowdata
    except Exception as e:
        logger.error(f"[GET LIFESPAN RELATION USER] Failed: {str(e)}")
        raise

async def copy_lifespan(content_id: str, copy_content_id: str, db_info: Dict) -> None:
    db, conn = db_info['db'], db_info.get('conn')
    logger.info(f"[COMMON][util][copyLifespan][contentId={content_id}][copyContentId={copy_content_id}]")
    
    rows = await get_lifespan_query(content_id, db)
    if rows:
        await insert_lifespan(copy_content_id, rows[0], db_info)
        relation_users = await get_lifespan_relation_user(content_id, db)
        if relation_users:
            await insert_lifespan_relation_user(copy_content_id, relation_users, db_info)

async def insert_lifespan(copy_content_id: str, lifespan: Dict, db_info: Dict) -> None:
    db, conn = db_info['db'], db_info.get('conn')
    try:
        with (conn.cursor() if conn else db.cursor()) as cur:
            cur.execute(
                "INSERT INTO CMS_CONTENT_LIFESPAN (CONTENT_ID, START_TIME, END_TIME, START_TIME_OFFSET, "
                "END_TIME_OFFSET, AUTO_DELETE, EMBARGO) VALUES (%s, %s, %s, %s, %s, %s, %s)",
                (
                    copy_content_id, lifespan.get('start_time'), lifespan.get('end_time'),
                    lifespan.get('start_time_offset'), lifespan.get('end_time_offset'),
                    lifespan.get('auto_delete'), lifespan.get('embargo')
                )
            )
        logger.info("Successfully insert lifespan copy")
    except Exception as e:
        logger.error(f"[INSERT LIFESPAN] Failed: {str(e)}")
        raise

async def insert_lifespan_relation_user(copy_content_id: str, relation_users: List[Dict], db_info: Dict) -> None:
    db, conn = db_info['db'], db_info.get('conn')
    try:
        with (conn.cursor() if conn else db.cursor()) as cur:
            for relation in relation_users:
                cur.execute(
                    "INSERT INTO CMS_CONTENT_LIFESPAN_RELATION_USER (CONTENT_ID, USER_ID) VALUES (%s, %s)",
                    (copy_content_id, relation['user_id'])
                )
        logger.info("Successfully insert lifespan relation user copy")
    except Exception as e:
        logger.error(f"[INSERT LIFESPAN RELATION USER] Failed: {str(e)}")
        raise

def check_json_error(err: Exception, req: Dict, res: Dict, next: Any) -> Optional[Dict]:
    if isinstance(err, SyntaxError) and getattr(err, 'status', None) == 400 and 'body' in err.__dict__:
        return {'status': 'error', 'message': 'Invalid JSON payload passed.'}
    next(err)
    return None

async def is_owner(role_id: str) -> bool:
    return role_id == 'ROLE_OWNER'

async def handle_preset_relation(
    operation: str, table_name: str, column_name: str, id: str, user_id: str,
    use_default: bool, db_instance: Any, connection: Any
) -> Dict:
    columns_values = {
        'UPDATER_ID': user_id,
        'UPDATED_TIME': 'NOW()'
    }
    if operation == 'add':
        columns_values['USE_DEFAULT'] = True
        columns_values['IS_DEFAULT'] = True
    elif operation == 'remove':
        columns_values['USE_DEFAULT'] = False
        columns_values['IS_DEFAULT'] = False
    elif operation == 'update':
        columns_values['USE_DEFAULT'] = use_default
    
    logger.info(f"Updating the following column values {columns_values} for column name {column_name} with id: {id} in table {table_name}")
    
    try:
        with (connection.cursor() if connection else db_instance.cursor()) as cur:
            query = f"UPDATE {table_name} SET {', '.join(f'{k} = %s' for k in columns_values)} WHERE {column_name} = %s RETURNING *"
            cur.execute(query, (*columns_values.values(), id))
            result = cur.fetchall()
        
        if not (result and len(result) == 1):
            raise handle_error('INTERNAL_SERVER_ERROR', f"Failed to {operation} preset relation")
        logger.info(f"Preset relation successfully {operation}ed: {result[0]}")
        return result[0]
    except Exception as e:
        logger.error(f"[HANDLE PRESET RELATION] Failed: {str(e)}")
        raise

def get_country_code_by_country_name(country_name: str) -> Optional[str]:
    # Placeholder for COUNTRY_LIST; replace with actual list or external service
    country_name_map = {}  # Example: {'United States': {'code': 'US'}, ...}
    country = country_name_map.get(country_name)
    return country.get('code') if country else None

async def check_screen_type(screen_type: str) -> bool:
    valid_types = [
        'SIGNAGE', 'BUSINESSTV', 'HOTELTV', 'HOSPITALITYTV', 'FLIP',
        'INDOORLEDSIGNAGE', 'OUTDOORLEDSIGNAGE', 'E-PAPER', 'ANDROID', 'WINDOWS'
    ]
    return screen_type in valid_types

async def check_pin_code_value(value: str, screen_type: str) -> bool:
    if screen_type in ['HOTELTV', 'BUSINESSTV']:
        return len(value) == 4
    if screen_type in ['SIGNAGE', 'INDOORLEDSIGNAGE', 'OUTDOORLEDSIGNAGE', 'E-PAPER', 'FLIP']:
        return len(value) == 6
    return False

async def is_valid_network_allow_list(input_str: str) -> bool:
    if not input_str.strip():
        return True
    pattern = r'^(tcp|udp):(\*|[\w+\.-]+(\.+[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}|\d+\.\d+\.\d+\.\d+):\d+$'
    for entry in input_str.split(';'):
        if not re.match(pattern, entry.strip()):
            logger.error(f"Not correct format: {entry}")
            return False
    return True

async def check_preset_data(data: List[Dict], screen_type: str) -> bool:
    # Placeholder for CAPABILITY; replace with actual capability lists
    CAPABILITY = {
        'SIGNAGE': [], 'HOTELTV': [], 'E-PAPER': [], 'ANDROID': [], 'WINDOWS': [],
        'INDOORLEDSIGNAGE': [], 'OUTDOORLEDSIGNAGE': []
    }
    
    for item in data:
        name, value = item.get('name'), item.get('value')
        if name == 'PINCode':
            if not await check_pin_code_value(value, screen_type):
                raise Exception(f"Invalid PINCode value - {value}, screenType - {screen_type}")
        if name == 'NetworkAllowedList':
            if not await is_valid_network_allow_list(value):
                raise Exception(f"Invalid NetworkAllowedList value - {value}")
        
        capability_list = CAPABILITY.get(screen_type, [])
        if screen_type in ['SIGNAGE', 'OUTDOORLEDSIGNAGE', 'INDOORLEDSIGNAGE', 'HOTELTV', 'E-PAPER', 'ANDROID', 'WINDOWS']:
            if name not in capability_list:
                raise Exception(f"[{screen_type}] Not Support {screen_type} Command Name - {name}")
    
    return True

async def get_published_info(cms_db: Any, dms_db: Any, id: str, index: int, published_infos: List) -> None:
    try:
        windows, expanded_wall, duplicated_wall, android, epaper = False, False, False, False, False
        android_player, windows_player, epaper_player = 'Android Player', 'Windows Player', 'E-Paper'
        
        with cms_db.cursor() as cur:
            cur.execute(
                "SELECT SCREEN_ID FROM CMS_SCREEN_DISTRIBUTION WHERE ID = %s OR POPUP_ID = %s",
                (id, id)
            )
            all_screens = cur.fetchall()
        
        for screen in all_screens or []:
            screen_id = screen['screen_id']
            if is_screenwall(screen_id) and not (expanded_wall and duplicated_wall):
                with dms_db.cursor() as cur:
                    cur.execute("SELECT PLAY_MODE FROM DMS_WALL WHERE SCREEN_ID = %s", (screen_id,))
                    play_mode = cur.fetchall()
                if play_mode and play_mode[0].get('play_mode') == 'EXPANDED':
                    expanded_wall = True
                elif play_mode and play_mode[0].get('play_mode') == 'DUPLICATED':
                    duplicated_wall = True
            else:
                with dms_db.cursor() as cur:
                    cur.execute("SELECT SCREEN_TYPE FROM DMS_SCREEN WHERE SCREEN_ID = %s", (screen_id,))
                    screen_type = cur.fetchall()
                if screen_type and screen_type[0].get('screen_type') == android_player:
                    android = True
                elif screen_type[0].get('screen_type') == windows_player:
                    windows = True
                elif screen_type[0].get('screen_type') == epaper_player:
                    epaper = True
            
            if all([expanded_wall, android, windows, epaper, duplicated_wall]):
                break
        
        published_infos[index] = {
            'expandedWall': expanded_wall, 'duplicatedWall': duplicated_wall,
            'android': android, 'windows': windows, 'epaper': epaper
        }
    except Exception as e:
        logger.error(f"[UtilService][getPublishedInfo]: {str(e)}")
        raise

def is_screenwall(screen_id: str) -> bool:
    return bool(re.match(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', screen_id, re.I))

async def check_rate_limit(user_id: str, redis_service: Any, interval: int, reset_time: int, max_req_allowed: int, api_name: str) -> bool:
    curr_time = int(datetime.now().timestamp() * 1000)
    lock = None
    try:
        lock = redis_service.lock([f"locks:cases-{user_id}-{api_name}-count", f"locks:cases-{user_id}-{api_name}-isSuspended"], 5000)
        redis_case_count = redis_service.get(f"cases-{user_id}-{api_name}-count")
        is_suspended = redis_service.get(f"cases-{user_id}-{api_name}-isSuspended")
        
        if is_suspended:
            raise handle_error('EXCEEDED_ATTEMPT_COUNT', 'Retry count exceeded. Please try after sometime')
        
        if not redis_case_count or json.loads(redis_case_count).get('expirationTime', 0) < curr_time:
            expire_time = curr_time + interval * 60 * 1000
            redis_service.setex(
                f"cases-{user_id}-{api_name}-count",
                interval * 60,
                json.dumps({'count': 1, 'expirationTime': expire_time})
            )
        elif json.loads(redis_case_count).get('count', 0) < max_req_allowed:
            redis_service.setex(
                f"cases-{user_id}-{api_name}-count",
                int((json.loads(redis_case_count)['expirationTime'] - curr_time) / 1000),
                json.dumps({
                    'count': json.loads(redis_case_count)['count'] + 1,
                    'expirationTime': json.loads(redis_case_count)['expirationTime']
                })
            )
        else:
            redis_service.setex(f"cases-{user_id}-{api_name}-isSuspended", reset_time * 60, 'true')
            raise handle_error('EXCEEDED_ATTEMPT_COUNT', 'Retry count exceeded. Please try after sometime')
        
        return True
    except Exception as e:
        logger.error(f"[COMMON][ERROR][checkRateLimit]: {str(e)}")
        raise
    finally:
        if lock:
            lock.release()

def get_country_code(req: Dict) -> str:
    country_code = req.get('headers', {}).get('cloudfront-viewer-country', '')
    if os.environ.get('NODE_ENV') == 'k8s':
        country_code = os.environ.get('COUNTRY_CODE', country_code)
    return country_code

# Lambda Handler
def lambda_handler(event: Dict, context: Any) -> Dict:
    """
    AWS Lambda handler to route utility service operations.
    
    Expected event structure:
    {
        "operation": "deleteUserIfOnlyInThisPlace|checkTagsetLock|...|getCountryCode",
        "params": {
            // Specific parameters for each operation, e.g.:
            // deleteUserIfOnlyInThisPlace: {usersToDelete, placeIds, region, organizationId, cookies}
            // checkTagsetLock: {tagsetId}
            // getDuplicateName: {contentList, originalName, contentType}
            // ...
        }
    }
    """
    db = None
    redis_service = None
    sqs_service = boto3.client('sqs')
    try:
        db = get_db_connection()
        redis_service = get_redis_connection()
        operation = event.get('operation')
        params = event.get('params', {})
        
        if not operation:
            raise handle_error('INVALID_OPERATION', 'Operation not specified in event')

        if operation == 'deleteUserIfOnlyInThisPlace':
            result = delete_user_if_only_in_this_place(params)
        elif operation == 'checkTagsetLock':
            result = check_tagset_lock(params.get('tagsetId'), db)
        elif operation == 'getDuplicateName':
            result = get_duplicate_name(
                params.get('contentList', []), params.get('originalName'), params.get('contentType')
            )
        elif operation == 'findDuplicateName':
            result = find_duplicate_name(
                params.get('fileName'), params.get('tableName'), params.get('columnName'),
                params.get('organizationId'), params.get('placeId'), db,
                params.get('conn', db), params.get('callerName')
            )
        elif operation == 'addResponseHeader':
            result = add_response_header(
                params.get('key'), params.get('value'), params.get('oriHeaders')
            )
        elif operation == 'isUserExistsInOrganizationByUserId':
            result = is_user_exists_in_organization_by_user_id(
                params.get('orgId'), params.get('userId'), db
            )
        elif operation == 'getExtension':
            result = get_extension(params.get('filename'))
        elif operation == 'maskSensitiveNameWithAsterisk':
            result = mask_sensitive_name_with_asterisk(params.get('name'))
        elif operation == 'isPIRSContent':
            result = is_pirs_content(params.get('mediaType'), params.get('type', ''))
        elif operation == 'isValidUUID':
            result = is_valid_uuid(params.get('uuidStr'), params.get('param', 'UUID'))
        elif operation == 'isValidEmail':
            result = is_valid_email(params.get('emailID'))
        elif operation == 'getS3KeyPop':
            result = get_s3_key_pop(
                params.get('organizationId'), params.get('placeId'), params.get('popId'), db
            )
        elif operation == 'extractTokenFromCookie':
            result = extract_token_from_cookie(params.get('headers', {}))
        elif operation == 'makeQuery':
            result = make_query(
                params.get('name'), params.get('array', []), params.get('caseType'),
                params.get('operator', 'AND'), params.get('typeOperator')
            )
        elif operation == 'makeShareQuery':
            result = make_share_query(params.get('array', []), params.get('operator', 'AND'))
        elif operation == 'makeSearchQuery':
            result = make_search_query(
                params.get('name'), params.get('array', []), params.get('operator', 'AND'),
                params.get('operatorInner')
            )
        elif operation == 'getOrderByLastRedis':
            result = get_order_by_last_redis(
                params.get('orderBy'), params.get('order'), params.get('userId'),
                params.get('updateKey'), redis_service
            )
        elif operation == 'updateOrderByLastRedis':
            result = update_order_by_last_redis(
                params.get('orderBy'), params.get('order'), params.get('userId'),
                params.get('updateKey'), redis_service
            )
        elif operation == 'revertOrderByLastRedis':
            result = revert_order_by_last_redis(
                params.get('orderBy'), params.get('order'), params.get('userId'),
                params.get('updateKey'), redis_service
            )
        elif operation == 'fetchIndexJSFiles':
            result = fetch_index_js_files(params.get('directoryPath'), params.get('serviceName'))
        elif operation == 'validateAccessToken':
            result = validate_access_token(
                params.get('saToken'), params.get('parsedSecret', {}), params.get('token')
            )
        elif operation == 'getUserJWT':
            result = get_user_jwt(params.get('token'))
        elif operation == 'getSupportedFileExtensions':
            result = get_supported_file_extensions()
        elif operation == 'sendRMStatePayloadToSQS':
            result = send_rm_state_payload_to_sqs(
                redis_service, sqs_service, params.get('notificationSQS'), params.get('body')
            )
        elif operation == 'isNumeric':
            result = is_numeric(params.get('value'))
        elif operation == 'getEmptyResponse':
            result = get_empty_response(params.get('start'), params.get('rowsPerPage'))
        elif operation == 'getOpenApiHeaderObject':
            result = get_open_api_header_object(params.get('event', {}))
        elif operation == 'isPlanXSeries':
            result = is_plan_x_series(params.get('placeId'), db, params.get('organizationId'))
        elif operation == 'setPublished':
            result = set_published(params.get('rows', []))
        elif operation == 'getLifespan':
            result = get_lifespan(
                params.get('content'), params.get('userId'), params.get('role'), db
            )
        elif operation == 'getLifespanQuery':
            result = get_lifespan_query(params.get('contentId'), db)
        elif operation == 'getLifespanRelationUser':
            result = get_lifespan_relation_user(params.get('contentId'), db)
        elif operation == 'copyLifespan':
            result = copy_lifespan(params.get('contentId'), params.get('copyContentId'), params.get('dbInfo', {}))
        elif operation == 'insertLifespan':
            result = insert_lifespan(
                params.get('copyContentId'), params.get('lifespan'), params.get('dbInfo', {})
            )
        elif operation == 'insertLifespanRelationUser':
            result = insert_lifespan_relation_user(
                params.get('copyContentId'), params.get('relationUsers', []), params.get('dbInfo', {})
            )
        elif operation == 'checkJsonError':
            result = check_json_error(
                params.get('err'), params.get('req', {}), params.get('res', {}), params.get('next')
            )
        elif operation == 'isOwner':
            result = is_owner(params.get('roleId'))
        elif operation == 'handlePresetRelation':
            result = handle_preset_relation(
                params.get('operation'), params.get('tableName'), params.get('columnName'),
                params.get('id'), params.get('userId'), params.get('useDefault'),
                db, params.get('connection', db)
            )
        elif operation == 'getCountryCodeByCountryName':
            result = get_country_code_by_country_name(params.get('countryName'))
        elif operation == 'checkScreenType':
            result = check_screen_type(params.get('screenType'))
        elif operation == 'checkPINCodeValue':
            result = check_pin_code_value(params.get('value'), params.get('screenType'))
        elif operation == 'isValidNetworkAllowList':
            result = is_valid_network_allow_list(params.get('input'))
        elif operation == 'checkPresetData':
            result = check_preset_data(params.get('data', []), params.get('screenType'))
        elif operation == 'getPublishedInfo':
            result = get_published_info(
                db, params.get('dmsDb', db), params.get('id'), params.get('index'), params.get('publishedInfos', [])
            )
        elif operation == 'isScreenwall':
            result = is_screenwall(params.get('screenId'))
        elif operation == 'checkRateLimit':
            result = check_rate_limit(
                params.get('userId'), redis_service, params.get('interval'), params.get('resetTime'),
                params.get('maxReqAllowed'), params.get('apiName')
            )
        elif operation == 'getCountryCode':
            result = get_country_code(params.get('req', {}))
        else:
            raise handle_error('INVALID_OPERATION', f"Operation {operation} not supported")

        return {
            'statusCode': 200,
            'body': json.dumps(result, default=str)
        }

    except Exception as e:
        logger.error(f"Lambda handler error: {str(e)}")
        return {
            'statusCode': 500,
            'body': json.dumps({'error': str(e)})
        }
    finally:
        if db:
            db.close()
        if redis_service:
            redis_service.close()

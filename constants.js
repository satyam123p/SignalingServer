import json
import logging
import uuid
import boto3
from typing import Dict, List, Any, Optional
import psycopg2
from psycopg2.extras import RealDictCursor
from datetime import datetime

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Placeholder for database connection (configure with your DB details)
def get_db_connection():
    return psycopg2.connect(
        dbname="your_db",
        user="your_user",
        password="your_password",
        host="your_host",
        port="your_port",
        cursor_factory=RealDictCursor
    )

# Utility functions
def is_valid_uuid(value: str, field_name: str) -> None:
    try:
        uuid.UUID(value)
    except ValueError:
        raise ValueError(f"Invalid {field_name}: {value}")

def is_tag_valid(tag: Dict[str, Any]) -> None:
    required_fields = ["tagName", "tagId", "tagsetCategoryId", "tagsetCategoryName", "tagKey", "tagsetCategoryKey"]
    for field in required_fields:
        if not tag.get(field):
            raise ValueError(f"Missing or invalid tag field: {field}")

def handle_error(error_code: str, message: str) -> Exception:
    return Exception(f"{error_code}: {message}")

# Placeholder for encryption using AWS KMS
def encrypt(value: str, key_type: str) -> str:
    kms_client = boto3.client('kms')
    # Replace with actual KMS key ID and encryption logic
    return kms_client.encrypt(
        KeyId='your-kms-key-id',
        Plaintext=value.encode()
    )['CiphertextBlob'].decode()

async def get_tags(table_name: str, column_name: str, category_name: str, id: str, db_instance: Any) -> List[Dict]:
    logger.info(f"[getTags API][tableName={table_name}][columnName={column_name}][categoryName={category_name}]")
    try:
        if category_name != 'screen':
            is_valid_uuid(id, f"{category_name}Id")
        with db_instance.cursor() as cur:
            cur.execute(f"SELECT * FROM {table_name} WHERE {column_name} = %s", (id,))
            tags_data = cur.fetchall()
        logger.info(f"[API][{category_name.upper()}][TAGS]: {json.dumps(tags_data)}")
        return tags_data or []
    except Exception as e:
        logger.error(f"[API][{category_name.upper()}][TAGS]: {str(e)}")
        raise

async def add_tags(
    table_name: str,
    tag_table_name: str,
    column_name: str,
    category_name: str,
    response_service: Dict,
    db_instance: Any,
    user_email: str,
    user_name: str,
    column_id: str = '',
    conn: Optional[Any] = None
) -> None:
    logger.info(f"[addTags API][tableName={table_name}][tagTableName={tag_table_name}][columnName={column_name}][categoryName={category_name}]")
    new_transaction = not conn
    try:
        if new_transaction:
            conn = db_instance
            conn.autocommit = False
        id = response_service.get('pathParameters', {}).get('id', column_id)
        if not id:
            raise handle_error('INSUFFICIENT_REQUIRED_PARAMETERS', 'ID is missing')
        if category_name != 'screen':
            is_valid_uuid(id, f"{category_name}Id")
        data = response_service.get('body', {})
        tags = data.get('tags', [])
        if not tags:
            raise handle_error('INSUFFICIENT_REQUIRED_PARAMETERS', 'Tags are missing')

        with (conn.cursor() if new_transaction else conn.cursor()) as cur:
            for tag in tags:
                is_tag_valid(tag)
                if not tag.get('tagKey') or len(tag['tagKey']) < 36:
                    raise handle_error('INSUFFICIENT_REQUIRED_PARAMETERS', 'tagKey is missing')
                if not tag.get('tagsetCategoryKey') or len(tag['tagsetCategoryKey']) < 36:
                    raise handle_error('INSUFFICIENT_REQUIRED_PARAMETERS', 'tagsetCategoryKey is missing')

                cur.execute(
                    f"SELECT TAG_ID FROM {tag_table_name} WHERE {column_name} = %s AND TAG_ID = %s",
                    (id, tag['tagId'])
                )
                if not cur.fetchall():
                    cur.execute(
                        f"INSERT INTO {tag_table_name} ({column_name}, TAG_NAME, TAG_ID, COLOR, TAGSET_CATEGORY_ID, TAGSET_CATEGORY_NAME, TAG_KEY, TAGSET_CATEGORY_KEY) "
                        f"VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
                        (
                            id, tag['tagName'], tag['tagId'], tag.get('color'), tag['tagsetCategoryId'],
                            tag['tagsetCategoryName'], tag['tagKey'], tag['tagsetCategoryKey']
                        )
                    )

            encrypted_email = encrypt(user_email, 'email')
            encrypted_name = encrypt(user_name, 'name')
            columns_values = {
                'UPDATER_ID': encrypted_email,
                'UPDATER_NAME': encrypted_name,
                'CHANGED_TIME' if table_name == 'DMS_SCREEN' else 'UPDATED_TIME': 'NOW()'
            }
            update_query = f"UPDATE {table_name} SET {', '.join(f'{k} = %s' for k in columns_values)} WHERE {column_name} = %s"
            cur.execute(update_query, (*columns_values.values(), id))

        if new_transaction:
            conn.commit()
    except Exception as e:
        if new_transaction:
            conn.rollback()
        logger.error(f"[API][{category_name.upper()}][TAGS]: {str(e)}")
        raise
    finally:
        if new_transaction:
            conn.autocommit = True

async def delete_tags(
    table_name: str,
    tag_table_name: str,
    column_name: str,
    category_name: str,
    response_service: Dict,
    db_instance: Any,
    user_email: str,
    user_name: str,
    lambda_service: Any,
    cookies: Dict,
    is_cross_service: bool = False,
    open_api_headers: Dict = {}
) -> Dict:
    logger.info(f"[deleteTags API][tableName={tag_table_name}][columnName={column_name}][categoryName={category_name}]")
    conn = db_instance
    conn.autocommit = False
    try:
        params = response_service.get('pathParameters', {})
        org_id, place_id, id, tag_id = params.get('organizationId'), params.get('placeId'), params.get('id'), params.get('tagId')
        is_valid_uuid(org_id, 'organizationId')
        is_valid_uuid(place_id, 'placeId')
        if category_name != 'screen':
            is_valid_uuid(id, f"{category_name}Id")

        tag_ids = [tag_id] if tag_id else response_service.get('body', {}).get('tags', [])
        tag_ids = [tag['tagId'] for tag in tag_ids] if isinstance(tag_ids, list) and all(isinstance(t, dict) for t in tag_ids) else tag_ids
        if not tag_ids:
            raise handle_error('INSUFFICIENT_REQUIRED_PARAMETERS', 'tagId value is missing in input')

        # Placeholder for Lambda invoke (DELETE_TAG_RELATION)
        lambda_client = boto3.client('lambda')
        payload = {
            'pathParameters': {'organizationId': org_id, 'placeId': place_id},
            'body': {'tagIds': ','.join(map(str, tag_ids)), 'type': category_name, 'typeId': id},
            'headers': open_api_headers
        }
        invoke_response = lambda_client.invoke(
            FunctionName='DELETE_TAG_RELATION',
            InvocationType='RequestResponse',
            Payload=json.dumps(payload)
        )
        invoke_data = json.loads(invoke_response['Payload'].read().decode())
        if invoke_data.get('statusCode') != 200:
            raise handle_error('INTERNAL_SERVER_ERROR', f"Fail to delete {category_name} tag relation")

        with conn.cursor() as cur:
            placeholders = ', '.join(f'%s' for _ in tag_ids)
            cur.execute(
                f"DELETE FROM {tag_table_name} WHERE {column_name} = %s AND TAG_ID IN ({placeholders})",
                (id, *tag_ids)
            )
            result = cur.rowcount

            if result == 1:
                encrypted_email = encrypt(user_email, 'email')
                encrypted_name = encrypt(user_name, 'name')
                columns_values = {
                    'UPDATER_ID': encrypted_email,
                    'UPDATER_NAME': encrypted_name,
                    'CHANGED_TIME' if table_name == 'DMS_SCREEN' else 'UPDATED_TIME': 'NOW()'
                }
                update_query = f"UPDATE {table_name} SET {', '.join(f'{k} = %s' for k in columns_values)} WHERE {column_name} = %s"
                cur.execute(update_query, (*columns_values.values(), id))

        conn.commit()
        return {'rowCount': result}
    except Exception as e:
        conn.rollback()
        logger.error(f"[API][{category_name.upper()}][TAGS]: {str(e)}")
        raise
    finally:
        conn.autocommit = True

async def update_tags(
    table_name: str,
    column_name: str,
    tag_table_name: str,
    response_service: Dict,
    db_instance: Any,
    caller_name: str = 'update tag'
) -> Dict:
    logger.info(f"[API][{caller_name.upper()}][TAGS] [Request Body]: {json.dumps(response_service.get('body', {}))}")
    conn = db_instance
    conn.autocommit = False
    try:
        org_id = response_service.get('pathParameters', {}).get('organizationId')
        body = response_service.get('body', {})
        action, new_tag_name, new_tagset_category_name, new_color = (
            body.get('action'), body.get('newTagName'), body.get('newTagsetCategoryName'), body.get('newColor')
        )
        tag_name, tagset_category_name, place_ids = (
            body.get('tagName'), body.get('tagsetCategoryName'), body.get('placeIds', [])
        )

        if place_ids != 'all' and not place_ids:
            raise handle_error('INSUFFICIENT_REQUIRED_PARAMETERS', 'placeIds is required')
        if not tagset_category_name:
            raise handle_error('INSUFFICIENT_REQUIRED_PARAMETERS', 'tagsetCategoryName is required')

        if action == 'CHANGE_TAG_NAME':
            if not tag_name or not new_tag_name:
                raise handle_error('INSUFFICIENT_REQUIRED_PARAMETERS', 'tagName and newTagName are required')
        elif action == 'CHANGE_CATEGORY_NAME':
            if not new_tagset_category_name:
                raise handle_error('INSUFFICIENT_REQUIRED_PARAMETERS', 'newTagsetCategoryName is required')
        elif action == 'CHANGE_CATEGORY_COLOR':
            if new_color is None or new_color == '':
                raise handle_error('INSUFFICIENT_REQUIRED_PARAMETERS', 'newColor is required')
        elif action == 'CHANGE_CATEGORY':
            if not all([tag_name, new_tagset_category_name, new_color]):
                raise handle_error('INSUFFICIENT_REQUIRED_PARAMETERS', 'tagName, newTagsetCategoryName, newColor are required')
        else:
            raise handle_error('INVALID_PARAMETER_VALUE', f"{action} is not supported for action")

        place_id_array = [f"'{pid}'" for pid in place_ids] if place_ids != 'all' else org_id
        query_condition = (
            f"{column_name} IN (SELECT {column_name} FROM {table_name} WHERE ORGANIZATION_ID = %s)"
            if place_ids == 'all' else
            f"{column_name} IN (SELECT {column_name} FROM {table_name} WHERE PLACE_ID IN ({','.join(place_id_array)}))"
        )

        update_query = None
        params = []
        if action == 'CHANGE_TAG_NAME':
            update_query = (
                f"UPDATE {tag_table_name} SET TAG_NAME = %s "
                f"WHERE TAG_NAME = %s AND TAGSET_CATEGORY_NAME = %s AND {query_condition}"
            )
            params = [new_tag_name, tag_name, tagset_category_name, org_id if place_ids == 'all' else org_id]
        elif action == 'CHANGE_CATEGORY_NAME':
            update_query = (
                f"UPDATE {tag_table_name} SET TAGSET_CATEGORY_NAME = %s "
                f"WHERE TAGSET_CATEGORY_NAME = %s AND {query_condition}"
            )
            params = [new_tagset_category_name, tagset_category_name, org_id if place_ids == 'all' else org_id]
        elif action == 'CHANGE_CATEGORY':
            update_query = (
                f"UPDATE {tag_table_name} SET TAGSET_CATEGORY_NAME = %s, COLOR = %s "
                f"WHERE TAG_NAME = %s AND TAGSET_CATEGORY_NAME = %s AND {query_condition}"
            )
            params = [new_tagset_category_name, new_color, tag_name, tagset_category_name, org_id if place_ids == 'all' else org_id]
        elif action == 'CHANGE_CATEGORY_COLOR':
            update_query = (
                f"UPDATE {tag_table_name} SET COLOR = %s "
                f"WHERE TAGSET_CATEGORY_NAME = %s AND {query_condition}"
            )
            params = [new_color, tagset_category_name, org_id if place_ids == 'all' else org_id]

        with conn.cursor() as cur:
            cur.execute(update_query, params)
            result = {'rowCount': cur.rowcount}

        conn.commit()
        return result
    except Exception as e:
        conn.rollback()
        logger.error(f"[ERROR][API][{caller_name.upper()}][TAGS]: {str(e)}")
        raise
    finally:
        conn.autocommit = True

async def delete_tag_by_category(
    table_name: str,
    column_name: str,
    tag_table_name: str,
    response_service: Dict,
    db_instance: Any,
    caller_name: str = 'delete tag'
) -> List[Dict]:
    logger.info(f"[API][{caller_name.upper()}][TAGS] [Request Body]: {json.dumps(response_service.get('body', {}))}")
    try:
        org_id = response_service.get('pathParameters', {}).get('organizationId')
        body = response_service.get('body', {})
        tag_names, place_ids, tagset_category_name = body.get('tagNames', []), body.get('placeIds', []), body.get('tagsetCategoryName')

        if place_ids != 'all' and not place_ids:
            raise handle_error('INSUFFICIENT_REQUIRED_PARAMETERS', 'placeIds is required')
        if not tag_names or not tagset_category_name:
            raise handle_error('INSUFFICIENT_REQUIRED_PARAMETERS', 'tagNames and tagsetCategoryName are required')
        if tag_names != 'all' and not tag_names:
            raise handle_error('INSUFFICIENT_REQUIRED_PARAMETERS', 'tagNames is required')

        query = (
            f"DELETE FROM {tag_table_name} WHERE TAGSET_CATEGORY_NAME = %s AND "
            f"{column_name} IN (SELECT {column_name} FROM {table_name} WHERE "
        )
        params = [tagset_category_name]
        if tag_names != 'all':
            query += f"TAG_NAME IN ({','.join(f'%s' for _ in tag_names)}) AND "
            params.extend(tag_names)
        if place_ids != 'all':
            query += f"PLACE_ID IN ({','.join(f'%s' for _ in place_ids)}))"
            params.extend(place_ids)
        else:
            query += f"ORGANIZATION_ID = %s)"
            params.append(org_id)

        with db_instance.cursor() as cur:
            cur.execute(query, params)
            deleted = cur.fetchall()
        logger.info(f"deleted: {deleted}, tagsetCategoryName: {tagset_category_name}")
        return deleted or []
    except Exception as e:
        logger.error(f"[ERROR][API][{caller_name.upper()}][TAGS]: {str(e)}")
        raise

async def copy_tags(
    id: str,
    new_id: str,
    tag_table_name: str,
    column_name: str,
    db_instance: Any,
    conn: Any,
    caller_name: str
) -> None:
    if not db_instance:
        raise handle_error('INTERNAL_SERVER_ERROR', 'Database Object Not Defined')
    try:
        with conn.cursor() as cur:
            cur.execute(f"SELECT * FROM {tag_table_name} WHERE {column_name} = %s", (id,))
            tags = cur.fetchall()
            logger.info(f"tags: {tags}")
            for tag in tags:
                cur.execute(
                    f"INSERT INTO {tag_table_name} ({column_name}, TAG_ID, TAG_NAME, COLOR, TAGSET_CATEGORY_ID, TAGSET_CATEGORY_NAME, TAG_KEY, TAGSET_CATEGORY_KEY) "
                    f"VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
                    (
                        new_id, tag['tag_id'], tag['tag_name'], tag.get('color'), tag['tagset_category_id'],
                        tag['tagset_category_name'], tag['tag_key'], tag['tagset_category_key']
                    )
                )
    except Exception as e:
        logger.error(f"[ERROR][{caller_name}]: {str(e)}")
        raise handle_error('INTERNAL_SERVER_ERROR', f"Failed to copy tags: {str(e)}")

async def get_system_tags(target: str, db_instance: Any, workspace_id: str) -> List[Dict]:
    try:
        query = """
            SELECT SYSTEM_TAG.*, RELATION.VALUE,
                CASE WHEN IS_USED IS NULL THEN FALSE ELSE IS_USED END
            FROM UMS_SYSTEM_TAG SYSTEM_TAG
            LEFT JOIN (
                SELECT *, CAST('TRUE' AS BOOLEAN) AS IS_USED
                FROM UMS_PLACE_RELATION_SYSTEM_TAG
                WHERE PLACE_ID = %s
            ) AS RELATION
            ON SYSTEM_TAG.SYSTEM_TAG_ID = RELATION.SYSTEM_TAG_ID
            WHERE TARGET = %s
        """
        with db_instance.cursor() as cur:
            cur.execute(query, (workspace_id, target))
            system_tags = cur.fetchall()
        return system_tags
    except Exception as e:
        logger.error(f"[GET-SYSTEM-TAGS][ERROR] {str(e)}")
        raise

async def get_system_tags_by_keys(tag_keys: List[str], db_instance: Any, target: str) -> List[Dict]:
    placeholders = ','.join(['%s'] * len(tag_keys))
    query = f"SELECT * FROM UMS_SYSTEM_TAG WHERE TARGET = %s AND KEY IN ({placeholders})"
    with db_instance.cursor() as cur:
        cur.execute(query, [target] + tag_keys)
        return cur.fetchall()

async def is_exists_tag_data_in_workspace(db_instance: Any, type: str, tag_data_ids: List[str], workspace_id: str) -> bool:
    query = ""
    if type == 'TAG_ID':
        placeholders = ','.join(['%s'] * len(tag_data_ids))
        query = f"""
            SELECT TAGSET.TAGSET_ID, CATEGORY.TAGSET_CATEGORY_ID, TAG.TAG_ID, TAG.TAG_NAME, TAGSET.IS_GLOBAL
            FROM AMS_PLACE_RELATION_TAGSET RELATION
            INNER JOIN AMS_TAGSET TAGSET ON TAGSET.TAGSET_ID = RELATION.TAGSET_ID
            INNER JOIN AMS_TAGSET_CATEGORY CATEGORY ON TAGSET.TAGSET_ID = CATEGORY.TAGSET_ID
            RIGHT JOIN AMS_TAG TAG ON CATEGORY.TAGSET_CATEGORY_ID = TAG.TAGSET_CATEGORY_ID
            WHERE RELATION.PLACE_ID = %s AND TAG.TAG_ID IN ({placeholders})
            UNION
            SELECT TAGSET.TAGSET_ID, CATEGORY.TAGSET_CATEGORY_ID, TAG.TAG_ID, TAG.TAG_NAME, TAGSET.IS_GLOBAL
            FROM AMS_TAGSET TAGSET
            INNER JOIN AMS_TAGSET_CATEGORY CATEGORY ON TAGSET.TAGSET_ID = CATEGORY.TAGSET_ID
            RIGHT JOIN AMS_TAG TAG ON CATEGORY.TAGSET_CATEGORY_ID = TAG.TAGSET_CATEGORY_ID
            WHERE TAG.TAG_ID IN ({placeholders}) AND TAGSET.IS_GLOBAL = TRUE
        """
    elif type == 'TAGSET_CATEGORY_ID':
        placeholders = ','.join(['%s'] * len(tag_data_ids))
        query = f"""
            SELECT TAGSET.TAGSET_ID, CATEGORY.TAGSET_CATEGORY_ID, TAGSET.IS_GLOBAL
            FROM AMS_PLACE_RELATION_TAGSET RELATION
            INNER JOIN AMS_TAGSET TAGSET ON TAGSET.TAGSET_ID = RELATION.TAGSET_ID
            INNER JOIN AMS_TAGSET_CATEGORY CATEGORY ON TAGSET.TAGSET_ID = CATEGORY.TAGSET_ID
            WHERE RELATION.PLACE_ID = %s AND CATEGORY.TAGSET_CATEGORY_ID IN ({placeholders})
            UNION
            SELECT TAGSET.TAGSET_ID, CATEGORY.TAGSET_CATEGORY_ID, TAGSET.IS_GLOBAL
            FROM AMS_TAGSET TAGSET
            INNER JOIN AMS_TAGSET_CATEGORY CATEGORY ON TAGSET.TAGSET_ID = CATEGORY.TAGSET_ID
            WHERE CATEGORY.TAGSET_CATEGORY_ID IN ({placeholders}) AND TAGSET.IS_GLOBAL = TRUE
        """
    elif type == 'SYSTEM_TAG_ID':
        placeholders = ','.join(['%s'] * len(tag_data_ids))
        query = f"""
            SELECT COALESCE(CUSTOM_SYSTEM_TAG.SYSTEM_TAG_ID, NOT_CUSTOM_SYSTEM_TAG.SYSTEM_TAG_ID) AS SYSTEM_TAG_ID
            FROM (
                SELECT * FROM UMS_SYSTEM_TAG SYSTEM_TAG
                WHERE SYSTEM_TAG.SYSTEM_TAG_ID IN ({placeholders}) AND TYPE != 'CUSTOM'
            ) AS NOT_CUSTOM_SYSTEM_TAG
            FULL JOIN (
                SELECT SYSTEM_TAG.*
                FROM UMS_SYSTEM_TAG SYSTEM_TAG
                INNER JOIN UMS_PLACE_RELATION_SYSTEM_TAG RELATION ON SYSTEM_TAG.SYSTEM_TAG_ID = RELATION.SYSTEM_TAG_ID
                WHERE PLACE_ID = %s AND SYSTEM_TAG.SYSTEM_TAG_ID IN ({placeholders}) AND TYPE = 'CUSTOM'
            ) AS CUSTOM_SYSTEM_TAG
            ON NOT_CUSTOM_SYSTEM_TAG.SYSTEM_TAG_ID = CUSTOM_SYSTEM_TAG.SYSTEM_TAG_ID
        """
    else:
        return False

    with db_instance.cursor() as cur:
        cur.execute(query, [workspace_id] + tag_data_ids + (tag_data_ids if 'UNION' in query else []))
        result = cur.fetchall()
    return len(result) == len(tag_data_ids)

# Lambda Handler
def lambda_handler(event: Dict, context: Any) -> Dict:
    db_instance = get_db_connection()
    try:
        operation = event.get('operation')
        response_service = event.get('responseService', {})
        if operation == 'getTags':
            result = get_tags(
                event.get('tableName'), event.get('columnName'), event.get('categoryName'),
                event.get('id'), db_instance
            )
        elif operation == 'addTags':
            result = add_tags(
                event.get('tableName'), event.get('tagTableName'), event.get('columnName'),
                event.get('categoryName'), response_service, db_instance,
                event.get('userEmail'), event.get('userName'), event.get('columnId', '')
            )
        elif operation == 'deleteTags':
            result = delete_tags(
                event.get('tableName'), event.get('tagTableName'), event.get('columnName'),
                event.get('categoryName'), response_service, db_instance,
                event.get('userEmail'), event.get('userName'), None,
                event.get('cookies', {}), event.get('isCrossService', False),
                event.get('openApiHeaders', {})
            )
        elif operation == 'updateTags':
            result = update_tags(
                event.get('tableName'), event.get('columnName'), event.get('tagTableName'),
                response_service, db_instance, event.get('callerName', 'update tag')
            )
        elif operation == 'deleteTagByCategory':
            result = delete_tag_by_category(
                event.get('tableName'), event.get('columnName'), event.get('tagTableName'),
                response_service, db_instance, event.get('callerName', 'delete tag')
            )
        elif operation == 'copyTags':
            result = copy_tags(
                event.get('id'), event.get('newId'), event.get('tagTableName'),
                event.get('columnName'), db_instance, db_instance,
                event.get('callerName')
            )
        elif operation == 'getSystemTags':
            result = get_system_tags(
                event.get('target'), db_instance, event.get('workspaceId')
            )
        elif operation == 'getSystemTagsByKeys':
            result = get_system_tags_by_keys(
                event.get('tagKeys'), db_instance, event.get('target')
            )
        elif operation == 'isExistsTagDataInWorkspace':
            result = is_exists_tag_data_in_workspace(
                db_instance, event.get('type'), event.get('tagDataIds'), event.get('workspaceId')
            )
        else:
            raise handle_error('INVALID_OPERATION', f"Operation {operation} not supported")

        return {
            'statusCode': 200,
            'body': json.dumps(result)
        }
    except Exception as e:
        logger.error(f"Lambda error: {str(e)}")
        return {
            'statusCode': 500,
            'body': json.dumps({'error': str(e)})
        }
    finally:
        db_instance.close()

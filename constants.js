from util_service import handle_error, is_valid_uuid, is_tag_valid
from logger_service import logger
from dkms_service import encrypt
from apirequest_service import APIRequestService
from database_service import DatabaseService
from typing import Optional, List, Dict, Any
import json
from uuid import uuid4

async def get_tags(table_name: str, column_name: str, category_name: str, id: str, db_instance: DatabaseService) -> List[Dict]:
    logger.info(f"[getTags API][tableName = {table_name}][columnName = {column_name}][categoryName = {category_name}]")
    try:
        if category_name != 'screen':
            await is_valid_uuid(id, f"{category_name}Id")
        tags_data = await db_instance.select_rows({
            "text": f"SELECT * FROM {table_name} WHERE {column_name} = $1",
            "values": [id],
        })
        logger.info(f"[API][{category_name.upper()}][TAGS] : {json.dumps(tags_data)}")
        return tags_data if tags_data else []
    except Exception as e:
        logger.error(f"[API][{category_name.upper()}][TAGS]", e)
        raise

async def add_tags(
    table_name: str,
    tag_table_name: str,
    column_name: str,
    category_name: str,
    response_service: Any,
    db_instance: DatabaseService,
    user_email: str,
    user_name: str,
    column_id: Optional[str] = "",
    conn: Optional[Any] = None
) -> None:
    logger.info(f"[addTags API][tableName = {table_name}][tagTableName = {tag_table_name}][columnName = {column_name}][categoryName = {category_name}]")
    new_transaction = not conn
    try:
        if new_transaction:
            conn = await db_instance.start_transaction()
        
        id = response_service.path_parameters.get('id', column_id)
        
        if category_name != 'screen':
            await is_valid_uuid(id, f"{category_name}Id")

        data = response_service.body
        if not data or not data.get('tags') or len(data['tags']) == 0:
            raise handle_error('INSUFFICIENT_REQUIRED_PARAMETERS', 'Tags are missing')

        for tag in data['tags']:
            await is_tag_valid(tag)
            tag_name = tag.get('tagName')
            tag_id = tag.get('tagId')
            color = tag.get('color')
            tagset_category_id = tag.get('tagsetCategoryId')
            tagset_category_name = tag.get('categoryName')
            tag_key = tag.get('tagKey')
            tagset_category_key = tag.get('tagsetCategoryKey')

            if not tag_key or len(tag_key) < 36:
                raise handle_error('INSUFFICIENT_REQUIRED_PARAMETERS', 'tagKey is missing')
            if not tagset_category_key or len(tagset_category_key) < 36:
                raise handle_error('INSUFFICIENT_REQUIRED_PARAMETERS', 'tagsetCategoryKey is missing')
            if not tagset_category_name:
                raise handle_error('INSUFFICIENT_REQUIRED_PARAMETERS', 'categoryName is missing')
            if tagset_category_id is None:
                raise handle_error('INSUFFICIENT_REQUIRED_PARAMETERS', 'tagsetCategoryId is missing')
            if tag_id is None:
                raise handle_error('INSUFFICIENT_REQUIRED_PARAMETERS', 'tagId is missing')
            if not tag_name:
                raise handle_error('INSUFFICIENT_REQUIRED_PARAMETERS', 'tagName is missing')

            try:
                tags = await db_instance.select_rows(
                    {
                        "text": f"SELECT TAG_ID FROM {tag_table_name} WHERE {column_name} = $1 AND TAG_ID = $2",
                        "values": [id, tag_id],
                    },
                    conn
                )
            except Exception as error:
                logger.error(error)
                raise handle_error('INTERNAL_SERVER_ERROR', f"fail to select {category_name} tag")

            if not tags:
                result = await db_instance.insert_row(
                    {
                        "table": tag_table_name,
                        "columns_values": {
                            column_name: id,
                            "TAG_NAME": tag_name,
                            "TAG_ID": tag_id,
                            "COLOR": color,
                            "TAGSET_CATEGORY_ID": tagset_category_id,
                            "TAGSET_CATEGORY_NAME": tagset_category_name,
                            "TAG_KEY": tag_key,
                            "TAGSET_CATEGORY_KEY": tagset_category_key,
                        },
                    },
                    conn
                )
                if not (result and result.row_count == 1):
                    raise handle_error('INTERNAL_SERVER_ERROR', f"fail to insert {category_name} tag")

        try:
            encrypted_user_email = await encrypt(user_email, 'email')
            encrypted_user_name = await encrypt(user_name, 'name')
            
            columns_values = {
                "UPDATER_ID": encrypted_user_email,
                "UPDATER_NAME": encrypted_user_name,
            }
            
            if table_name == 'DMS_SCREEN':
                columns_values['CHANGED_TIME'] = 'NOW()'
            else:
                columns_values['UPDATED_TIME'] = 'NOW()'

            await db_instance.update_row({
                "table": table_name,
                "columns_values": columns_values,
                "wheres": {column_name: id},
            }, conn)
        except Exception as error:
            logger.error(error)
            raise handle_error('INTERNAL_SERVER_ERROR', f"fail to update {category_name}")

        if new_transaction:
            await db_instance.commit_transaction(conn)
    except Exception as error:
        if new_transaction:
            await db_instance.rollback_transaction(conn)
        logger.error(f"[API][{category_name.upper()}][TAGS] {error}")
        raise
    finally:
        if new_transaction:
            await db_instance.end_transaction(conn)

async def delete_tags(
    table_name: str,
    tag_table_name: str,
    column_name: str,
    category_name: str,
    response_service: Any,
    db_instance: DatabaseService,
    user_email: str,
    user_name: str,
    lambda_service: Any,
    cookies: Dict,
    is_cross_service: bool = False,
    open_api_headers: Dict = {}
) -> Any:
    logger.info(f"[deleteTags API][tableName = {tag_table_name}][columnName = {column_name}][categoryName = {category_name}]")
    conn = None
    result_data = None
    api_request_service = APIRequestService()
    try:
        path_params = response_service.path_parameters
        organization_id = path_params.get('organizationId')
        place_id = path_params.get('placeId')
        id = path_params.get('id')
        tag_id = path_params.get('tagId')

        conn = await db_instance.start_transaction()
        await is_valid_uuid(organization_id, 'organizationId')
        await is_valid_uuid(place_id, 'placeId')
        if category_name != 'screen':
            await is_valid_uuid(id, f"{category_name}Id")

        tag_ids = [tag_id] if tag_id else (
            [tag['tagId'] for tag in response_service.body.get('tags', [])]
            if response_service.body and isinstance(response_service.body.get('tags'), list)
            else []
        )

        if not tag_ids:
            raise handle_error('INSUFFICIENT_REQUIRED_PARAMETERS', 'tagId value is missing in input')

        for tag_id in tag_ids:
            if not tag_id or not isinstance(tag_id, (int, str)):
                raise handle_error('INSUFFICIENT_REQUIRED_PARAMETERS', 'tagId value is missing in input')

        payload = {
            "pathParameters": {
                "organizationId": organization_id,
                "placeId": place_id,
            },
            "body": {
                "tagIds": ",".join(map(str, tag_ids)),
                "type": category_name,
                "typeId": id,
            },
            "headers": open_api_headers,
        }

        try:
            if is_cross_service:
                invoke_data = await api_request_service.invoke(
                    'DELETE_TAG_RELATION', payload, 'DELETE', cookies, logger.get_log_context()
                )
            else:
                invoke_data = await lambda_service.invoke_and_get_payload(
                    'DELETE_TAG_RELATION', payload, logger.get_log_context()
                )
            logger.info(f"invokeStatusCode: {invoke_data.status_code}")
        except Exception as e:
            logger.error(str(e))
            raise handle_error('INTERNAL_SERVER_ERROR', f"Fail to delete {category_name} tag relation: Lambda invoke error")

        if invoke_data.status_code == 200:  # Assuming HTTP_OK is 200
            result = await db_instance.delete_rows({
                "text": f"DELETE FROM {tag_table_name} WHERE 1 = 1 AND {column_name} = $1 AND TAG_ID IN ({','.join(f'${i+2}' for i in range(len(tag_ids)))})",
                "values": [id, *tag_ids],
            }, conn)

            if result and result.row_count == 1:
                result_data = result
                try:
                    encrypted_user_email = await encrypt(user_email, 'email')
                    encrypted_user_name = await encrypt(user_name, 'name')

                    columns_values = {
                        "UPDATER_ID": encrypted_user_email,
                        "UPDATER_NAME": encrypted_user_name,
                    }

                    if table_name == 'DMS_SCREEN':
                        columns_values['CHANGED_TIME'] = 'NOW()'
                    else:
                        columns_values['UPDATED_TIME'] = 'NOW()'

                    await db_instance.update_row({
                        "table": table_name,
                        "columns_values": columns_values,
                        "wheres": {column_name: id},
                    }, conn)
                except Exception as error:
                    logger.error(str(error))
                    raise handle_error('INTERNAL_SERVER_ERROR', f"fail to update {category_name}")
            # Note: Removed commented-out error throw as per original code
        else:
            raise handle_error('INTERNAL_SERVER_ERROR', f"Fail to delete {category_name} tags")
    except Exception as error:
        logger.error(f"[API][{category_name.upper()}][TAGS] {error}")
        await db_instance.rollback_transaction(conn)
        raise
    finally:
        await db_instance.end_transaction(conn)
    await db_instance.commit_transaction(conn)
    return result_data

async def update_tags(
    table_name: str,
    column_name: str,
    tag_table_name: str,
    response_service: Any,
    db_instance: DatabaseService,
    caller_name: str = 'update tag'
) -> Any:
    result = None
    conn = None
    path_params = response_service.path_parameters
    organization_id = path_params.get('organizationId')
    body = response_service.body
    action = body.get('action')
    new_tag_name = body.get('newTagName')
    new_tagset_category_name = body.get('newTagsetCategoryName')
    new_color = body.get('newColor')
    tag_name = body.get('tagName')
    tagset_category_name = body.get('tagsetCategoryName')
    place_ids = body.get('placeIds', [])

    logger.info(f"[API][{caller_name.upper()}][TAGS] [Request Body] : {json.dumps(body)}")
    try:
        conn = await db_instance.start_transaction()

        if place_ids != 'all' and not place_ids:
            raise handle_error('INSUFFICIENT_REQUIRED_PARAMETERS', 'placeIds is required.')
        if not tagset_category_name:
            raise handle_error('INSUFFICIENT_REQUIRED_PARAMETERS', 'tagsetCategoryName is required.')

        if action == 'CHANGE_TAG_NAME':
            if not tag_name:
                raise handle_error('INSUFFICIENT_REQUIRED_PARAMETERS', 'tagName is required.')
            if not new_tag_name:
                raise handle_error('INSUFFICIENT_REQUIRED_PARAMETERS', 'newTagName is required.')
        elif action == 'CHANGE_CATEGORY_NAME':
            if not new_tagset_category_name:
                raise handle_error('INSUFFICIENT_REQUIRED_PARAMETERS', 'newTagsetCategoryName is required.')
        elif action == 'CHANGE_CATEGORY_COLOR':
            if new_color is None or new_color == '':
                raise handle_error('INSUFFICIENT_REQUIRED_PARAMETERS', 'newColor is required.')
        elif action == 'CHANGE_CATEGORY':
            if not tag_name:
                raise handle_error('INSUFFICIENT_REQUIRED_PARAMETERS', 'tagName is required.')
            if not new_tagset_category_name:
                raise handle_error('INSUFFICIENT_REQUIRED_PARAMETERS', 'newTagsetCategoryName is required.')
            if new_color is None or new_color == '':
                raise handle_error('INSUFFICIENT_REQUIRED_PARAMETERS', 'newColor is required.')
        else:
            raise handle_error('INVALID_PARAMETER_VALUE', f"{action} is not supported for action.")

        place_id_array = [f"'{u}'" for u in place_ids] if place_ids != 'all' else organization_id
        query_condition_place_ids = (
            f"{column_name} IN (SELECT {column_name} FROM {table_name} WHERE ORGANIZATION_ID = '{organization_id}')"
            if place_ids == 'all'
            else f"{column_name} IN (SELECT {column_name} FROM {table_name} WHERE PLACE_ID IN ({','.join(place_id_array)}))"
        )
        logger.info(f'queryConditionPlaceIds {query_condition_place_ids}')

        update_query = None
        if action == 'CHANGE_TAG_NAME':
            logger.info(f"Tag name changed newTag: {new_tag_name} tag: {tag_name} category: {tagset_category_name} {place_id_array}")
            update_query = {
                "table": tag_table_name,
                "columns_values": {"TAG_NAME": new_tag_name},
                "wheres": {
                    "TAG_NAME": tag_name,
                    "TAGSET_CATEGORY_NAME": tagset_category_name,
                    "@1": query_condition_place_ids,
                },
            }
        elif action == 'CHANGE_CATEGORY_NAME':
            logger.info(f"tagsetCategoryName changed newCategory: {new_tagset_category_name} category: {tagset_category_name} {place_id_array}")
            update_query = {
                "table": tag_table_name,
                "columns_values": {"TAGSET_CATEGORY_NAME": new_tagset_category_name},
                "wheres": {
                    "TAGSET_CATEGORY_NAME": tagset_category_name,
                    "@1": query_condition_place_ids,
                },
            }
        elif action == 'CHANGE_CATEGORY':
            logger.info(f"category changed color: {new_color} newCategory: {new_tagset_category_name} tag: {tag_name} categoryName: {tagset_category_name} {place_id_array}")
            update_query = {
                "table": tag_table_name,
                "columns_values": {
                    "TAGSET_CATEGORY_NAME": new_tagset_category_name,
                    "COLOR": new_color,
                },
                "wheres": {
                    "TAG_NAME": tag_name,
                    "TAGSET_CATEGORY_NAME": tagset_category_name,
                    "@1": query_condition_place_ids,
                },
            }
        elif action == 'CHANGE_CATEGORY_COLOR':
            logger.info(f"Tag Color changed color: {new_color} category: {tagset_category_name} {place_id_array}")
            update_query = {
                "table": tag_table_name,
                "columns_values": {"COLOR": new_color},
                "wheres": {
                    "TAGSET_CATEGORY_NAME": tagset_category_name,
                    "@1": query_condition_place_ids,
                },
            }

        try:
            result = await db_instance.update_row(update_query, conn)
        except Exception as error:
            logger.error(str(error))
            raise handle_error('INTERNAL_SERVER_ERROR', f"Failed to update tag for {caller_name}.")
        await db_instance.commit_transaction(conn)
    except Exception as error:
        await db_instance.rollback_transaction(conn)
        logger.error(f"[ERROR][API][{caller_name.upper()}][TAGS] {error}")
        raise
    finally:
        await db_instance.end_transaction(conn)
    return result

async def delete_tag_by_category(
    table_name: str,
    column_name: str,
    tag_table_name: str,
    response_service: Any,
    db_instance: DatabaseService,
    caller_name: str = 'delete tag'
) -> List[Dict]:
    logger.info(f"[API][{caller_name.upper()}][TAGS] [Request Body] : {json.dumps(response_service.body)}")
    try:
        organization_id = response_service.path_parameters.get('organizationId')
        body = response_service.body or {}
        tag_names = body.get('tagNames', [])
        place_ids = body.get('placeIds', [])
        tagset_category_name = body.get('tagsetCategoryName')

        if place_ids != 'all' and not place_ids:
            raise handle_error('INSUFFICIENT_REQUIRED_PARAMETERS', 'placeIds is required.')
        if not tag_names or not tagset_category_name:
            raise handle_error('INSUFFICIENT_REQUIRED_PARAMETERS', 'tagNames and tagsetCategoryName are required.')
        if tag_names != 'all' and not tag_names:
            raise handle_error('INSUFFICIENT_REQUIRED_PARAMETERS', 'tagNames is required.')

        query = (
            f"DELETE FROM {tag_table_name} WHERE TAGSET_CATEGORY_NAME = $1 AND "
            f"{column_name} IN (SELECT {column_name} FROM {table_name} WHERE "
        )
        if tag_names != 'all':
            tag_names = [f"'{name}'" for name in tag_names]
            query += f"TAG_NAME IN ({','.join(tag_names)}) AND "
        
        query += (
            f"PLACE_ID IN ({','.join(f"'{pid}'" for pid in place_ids)}))"
            if place_ids != 'all'
            else f"ORGANIZATION_ID = '{organization_id}')"
        )

        deleted = await db_instance.delete_rows({
            "text": query,
            "values": [tagset_category_name],
            "returning": '*',
        })
        logger.info(f"deleted {deleted} {tagset_category_name}")
        if deleted and len(deleted) > 0:
            return deleted
        return []
    except Exception as error:
        logger.error(f"[ERROR][API][{caller_name.upper()}][TAGS] {error}")
        raise

async def copy_tags(
    id: str,
    new_id: str,
    tag_table_name: str,
    column_name: str,
    db_instance: DatabaseService,
    conn: Any,
    caller_name: str
) -> None:
    if not db_instance:
        raise handle_error('INTERNAL_SERVER_ERROR', 'Database Object Not Defined')

    try:
        tags = await db_instance.select_rows(
            {
                "query": f"SELECT * FROM {tag_table_name} WHERE {column_name} = $1",
                "values": [id],
            },
            conn
        )
        logger.info(f"tags {tags}")
    except Exception as error:
        logger.error(str(error))
        raise handle_error('INTERNAL_SERVER_ERROR', "Failed to get tags from tag table")

    for tag in tags:
        try:
            await db_instance.insert_row(
                {
                    "table": tag_table_name,
                    "columns_values": {
                        column_name: new_id,
                        "TAG_ID": tag['tagId'],
                        "TAG_NAME": tag['tagName'],
                        "COLOR": tag['color'],
                        "TAGSET_CATEGORY_ID": tag['tagsetCategoryId'],
                        "TAGSET_CATEGORY_NAME": tag['tagsetCategoryName'],
                        "TAG_KEY": tag['tagKey'],
                        "TAGSET_CATEGORY_KEY": tag['tagsetCategoryKey'],
                    },
                },
                conn
            )
        except Exception as error:
            logger.error(str(error))
            raise handle_error('INTERNAL_SERVER_ERROR', "Failed to insert tags to tag table")

async def get_system_tags(target: str, db_instance: DatabaseService, workspace_id: str) -> List[Dict]:
    try:
        system_tag_query = """
            SELECT SYSTEM_TAG.*, RELATION.VALUE,
       

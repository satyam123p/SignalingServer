import json
import logging
import psycopg2
from psycopg2.extras import RealDictCursor
from typing import Dict, Any

# Import the tag service functions (assumed to be in tags_service.py)
from tags_service import (
    get_tags,
    add_tags,
    delete_tags,
    update_tags,
    delete_tag_by_category,
    copy_tags,
    get_system_tags,
    get_system_tags_by_keys,
    is_exists_tag_data_in_workspace,
    handle_error
)

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

def lambda_handler(event: Dict, context: Any) -> Dict:
    """
    AWS Lambda handler to route tag-related operations.
    
    Expected event structure:
    {
        "operation": "getTags|addTags|deleteTags|updateTags|deleteTagByCategory|copyTags|getSystemTags|getSystemTagsByKeys|isExistsTagDataInWorkspace",
        "tableName": str,              // For getTags, addTags, deleteTags, updateTags, deleteTagByCategory, copyTags
        "tagTableName": str,           // For addTags, deleteTags, updateTags, deleteTagByCategory, copyTags
        "columnName": str,             // For getTags, addTags, deleteTags, updateTags, deleteTagByCategory, copyTags
        "categoryName": str,           // For getTags, addTags, deleteTags
        "id": str,                     // For getTags, addTags, deleteTags, copyTags
        "newId": str,                  // For copyTags
        "responseService": {
            "pathParameters": {         // Contains organizationId, placeId, id, tagId, etc.
                "organizationId": str,
                "placeId": str,
                "id": str,
                "tagId": str
            },
            "body": {                  // Contains tags, tagName, newTagName, etc.
                "tags": [{"tagId": str, "tagName": str, "color": str, ...}],
                "action": str,
                "newTagName": str,
                "newTagsetCategoryName": str,
                "newColor": str,
                "tagsetCategoryName": str,
                "placeIds": [str] | "all"
            }
        },
        "userEmail": str,              // For addTags, deleteTags
        "userName": str,               // For addTags, deleteTags
        "cookies": Dict,               // For deleteTags
        "isCrossService": bool,        // For deleteTags
        "openApiHeaders": Dict,        // For deleteTags
        "callerName": str,             // For updateTags, deleteTagByCategory, copyTags
        "target": str,                 // For getSystemTags, getSystemTagsByKeys
        "workspaceId": str,            // For getSystemTags, isExistsTagDataInWorkspace
        "tagKeys": [str],             // For getSystemTagsByKeys
        "type": str,                   // For isExistsTagDataInWorkspace
        "tagDataIds": [str]           // For isExistsTagDataInWorkspace
    }
    """
    db_instance = None
    try:
        # Initialize database connection
        db_instance = get_db_connection()
        
        # Extract operation from event
        operation = event.get('operation')
        if not operation:
            raise handle_error('INVALID_OPERATION', 'Operation not specified in event')

        # Extract common parameters
        response_service = event.get('responseService', {})
        table_name = event.get('tableName')
        tag_table_name = event.get('tagTableName')
        column_name = event.get('columnName')
        category_name = event.get('categoryName')
        caller_name = event.get('callerName', 'operation')

        # Route to appropriate function based on operation
        if operation == 'getTags':
            result = get_tags(
                table_name=table_name,
                column_name=column_name,
                category_name=category_name,
                id=event.get('id'),
                db_instance=db_instance
            )
        elif operation == 'addTags':
            result = add_tags(
                table_name=table_name,
                tag_table_name=tag_table_name,
                column_name=column_name,
                category_name=category_name,
                response_service=response_service,
                db_instance=db_instance,
                user_email=event.get('userEmail'),
                user_name=event.get('userName'),
                column_id=event.get('columnId', ''),
                conn=db_instance
            )
        elif operation == 'deleteTags':
            result = delete_tags(
                table_name=table_name,
                tag_table_name=tag_table_name,
                column_name=column_name,
                category_name=category_name,
                response_service=response_service,
                db_instance=db_instance,
                user_email=event.get('userEmail'),
                user_name=event.get('userName'),
                lambda_service=None,  # Pass boto3 client if needed
                cookies=event.get('cookies', {}),
                is_cross_service=event.get('isCrossService', False),
                open_api_headers=event.get('openApiHeaders', {})
            )
        elif operation == 'updateTags':
            result = update_tags(
                table_name=table_name,
                column_name=column_name,
                tag_table_name=tag_table_name,
                response_service=response_service,
                db_instance=db_instance,
                caller_name=caller_name
            )
        elif operation == 'deleteTagByCategory':
            result = delete_tag_by_category(
                table_name=table_name,
                column_name=column_name,
                tag_table_name=tag_table_name,
                response_service=response_service,
                db_instance=db_instance,
                caller_name=caller_name
            )
        elif operation == 'copyTags':
            result = copy_tags(
                id=event.get('id'),
                new_id=event.get('newId'),
                tag_table_name=tag_table_name,
                column_name=column_name,
                db_instance=db_instance,
                conn=db_instance,
                caller_name=caller_name
            )
        elif operation == 'getSystemTags':
            result = get_system_tags(
                target=event.get('target'),
                db_instance=db_instance,
                workspace_id=event.get('workspaceId')
            )
        elif operation == 'getSystemTagsByKeys':
            result = get_system_tags_by_keys(
                tag_keys=event.get('tagKeys', []),
                db_instance=db_instance,
                target=event.get('target')
            )
        elif operation == 'isExistsTagDataInWorkspace':
            result = is_exists_tag_data_in_workspace(
                db_instance=db_instance,
                type=event.get('type'),
                tag_data_ids=event.get('tagDataIds', []),
                workspace_id=event.get('workspaceId')
            )
        else:
            raise handle_error('INVALID_OPERATION', f"Operation {operation} not supported")

        # Return successful response
        return {
            'statusCode': 200,
            'body': json.dumps(result, default=str)  # Handle non-serializable objects like datetime
        }

    except Exception as e:
        logger.error(f"Lambda handler error: {str(e)}")
        return {
            'statusCode': 500,
            'body': json.dumps({'error': str(e)})
        }
    finally:
        if db_instance:
            db_instance.close()


```python
import json
import logging
from typing import Dict, Any, Optional
import psycopg2
from psycopg2.extras import RealDictCursor

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

# Constants
class Type:
    CONTENT = 'CONTENT'
    PLAYLIST = 'PLAYLIST'

# Placeholder for shared status functions (replace with actual implementations)
async def get_shared_status_by_playlist_id(playlist_id: str) -> Dict:
    # TODO: Implement actual logic to fetch shared status
    return {"isShared": False, "originalPlaceId": ""}

async def get_shared_status_by_program_id(program_id: str) -> Dict:
    # TODO: Implement actual logic to fetch shared status
    return {"isShared": False, "originalPlaceId": ""}

async def set_publishing_by_playlist_id(
    playlist_id: str, status: bool, conn: Optional[Any], place_id: str, db_instance: Any
) -> None:
    try:
        shared_status = await get_shared_status_by_playlist_id(playlist_id)
        is_shared = shared_status.get("isShared")
        original_place_id = shared_status.get("originalPlaceId")
        
        with (conn.cursor() if conn else db_instance.cursor()) as cur:
            if is_shared and original_place_id != place_id:
                cur.execute(
                    """UPDATE CMS_CONTENT_SHARE
                    SET SHARED_PUBLISHED = %s
                    WHERE PLACE_ID=%s AND CONTENT_ID IN (SELECT DISTINCT CONTENT_ID
                                        FROM CMS_PLAYLIST_RELATION_CONTENT A, CMS_PLAYLIST_VERSION B
                                        WHERE A.PLAYLIST_ID = %s AND A.PLAYLIST_ID = B.PLAYLIST_ID
                                        AND A.VERSION = B.VERSION AND B.IS_ACTIVE = TRUE)""",
                    (status, place_id, playlist_id)
                )
            else:
                cur.execute(
                    """UPDATE CMS_CONTENT
                    SET PUBLISHED = %s
                    WHERE CONTENT_ID IN (SELECT DISTINCT CONTENT_ID
                                        FROM CMS_PLAYLIST_RELATION_CONTENT A,
                                            CMS_PLAYLIST_VERSION B
                                        WHERE A.PLAYLIST_ID = %s OR A.PLAYLIST_ID IN
                                        (SELECT SUB_PLAYLIST_ID FROM CMS_PLAYLIST_RELATION_SUB_PLAYLIST WHERE PLAYLIST_ID = %s)
                                        AND A.PLAYLIST_ID = B.PLAYLIST_ID
                                        AND A.VERSION = B.VERSION
                                        AND B.IS_ACTIVE = TRUE)""",
                    (status, playlist_id, playlist_id)
                )
                
                cur.execute(
                    """UPDATE CMS_PLAYLIST
                    SET PUBLISHED = %s
                    WHERE PLAYLIST_ID IN (SELECT DISTINCT SUB_PLAYLIST_ID
                                        FROM CMS_PLAYLIST_RELATION_SUB_PLAYLIST A,
                                            CMS_PLAYLIST_VERSION B
                                        WHERE A.PLAYLIST_ID = %s
                                        AND A.PLAYLIST_ID = B.PLAYLIST_ID
                                        AND A.VERSION = B.VERSION
                                        AND B.IS_ACTIVE = TRUE)""",
                    (status, playlist_id)
                )
        
        if conn:
            conn.commit()
        
        logger.info(f"[PublishingService][setPublishingByPlaylistId] Completed, playlist id {playlist_id}, status: {status}")
    except Exception as e:
        logger.error(
            f"[PublishingService][setPublishingByPlaylistId] Fail to set publishing by playlist id {playlist_id}, status: {status}",
            exc_info=e
        )
        raise

async def set_publishing_by_program_id(
    program_id: str, status: bool, conn: Optional[Any], place_id: str, db_instance: Any
) -> None:
    try:
        updated_playlists = []
        shared_status = await get_shared_status_by_program_id(program_id)
        is_shared = shared_status.get("isShared")
        original_place_id = shared_status.get("originalPlaceId")
        
        with (conn.cursor() if conn else db_instance.cursor()) as cur:
            if is_shared and original_place_id != place_id:
                cur.execute(
                    """UPDATE CMS_CONTENT_SHARE
                    SET SHARED_PUBLISHED = %s
                    WHERE PLACE_ID=%s AND CONTENT_ID IN (SELECT DISTINCT CONTENT_ID
                                        FROM PMS_SCHEDULE A,
                                            PMS_PROGRAM_RELATION_SCHEDULE B
                                        WHERE B.PROGRAM_ID = %s
                                        AND A.SCHEDULE_ID = B.SCHEDULE_ID
                                        AND A.CONTENT_TYPE = %s)""",
                    (status, place_id, program_id, Type.CONTENT)
                )
                
                cur.execute(
                    """UPDATE CMS_PLAYLIST_SHARE
                    SET SHARED_PUBLISHED = %s
                    WHERE PLACE_ID=%s AND PLAYLIST_ID IN (SELECT DISTINCT CONTENT_ID
                                        FROM PMS_SCHEDULE A,
                                            PMS_PROGRAM_RELATION_SCHEDULE B
                                        WHERE B.PROGRAM_ID = %s
                                        AND A.SCHEDULE_ID = B.SCHEDULE_ID
                                        AND A.CONTENT_TYPE = %s)
                    RETURNING *""",
                    (status, place_id, program_id, Type.PLAYLIST)
                )
                updated_playlists = cur.fetchall()
            else:
                cur.execute(
                    """UPDATE CMS_CONTENT
                    SET PUBLISHED = %s
                    WHERE CONTENT_ID IN (SELECT DISTINCT CONTENT_ID
                                        FROM PMS_SCHEDULE A,
                                            PMS_PROGRAM_RELATION_SCHEDULE B
                                        WHERE B.PROGRAM_ID = %s
                                        AND A.SCHEDULE_ID = B.SCHEDULE_ID
                                        AND A.CONTENT_TYPE = %s)""",
                    (status, program_id, Type.CONTENT)
                )
                
                cur.execute(
                    """UPDATE CMS_PLAYLIST
                    SET PUBLISHED = %s
                    WHERE PLAYLIST_ID IN (SELECT DISTINCT CONTENT_ID
                                        FROM PMS_SCHEDULE A,
                                            PMS_PROGRAM_RELATION_SCHEDULE B
                                        WHERE B.PROGRAM_ID = %s
                                        AND A.SCHEDULE_ID = B.SCHEDULE_ID
                                        AND A.CONTENT_TYPE = %s)
                    RETURNING *""",
                    (status, program_id, Type.PLAYLIST)
                )
                updated_playlists = cur.fetchall()
        
        if conn:
            conn.commit()
        
        logger.info(f"[PublishingService][setPublishingByProgramId] Updated playlists: {json.dumps(updated_playlists)}")
        
        if updated_playlists:
            for playlist in updated_playlists:
                await set_publishing_by_playlist_id(
                    playlist['playlist_id'], status, conn, place_id, db_instance
                )
        
        logger.info(f"[PublishingService][setPublishingByProgramId] Completed, programId id {program_id}, status: {status}")
    except Exception as e:
        logger.error(
            f"[PublishingService][setPublishingByProgramId] Fail to set publishing by programId id {program_id}, status: {status}",
            exc_info=e
        )
        raise

# Lambda Handler
def lambda_handler(event: Dict, context: Any) -> Dict:
    """
    AWS Lambda handler to route publishing service operations.
    
    Expected event structure:
    {
        "operation": "setPublishingByPlaylistId|setPublishingByProgramId",
        "params": {
            "id": str,           // playlistId or programId
            "status": bool,      // Publishing status
            "placeId": str,      // Place ID
            "conn": null         // Optional connection object (null for new connection)
        }
    }
    """
    db_instance = None
    try:
        db_instance = get_db_connection()
        operation = event.get('operation')
        params = event.get('params', {})
        
        if not operation:
            raise Exception('INVALID_OPERATION: Operation not specified in event')
        
        if operation == 'setPublishingByPlaylistId':
            result = set_publishing_by_playlist_id(
                params.get('id'), params.get('status'), params.get('conn'), params.get('placeId'), db_instance
            )
        elif operation == 'setPublishingByProgramId':
            result = set_publishing_by_program_id(
                params.get('id'), params.get('status'), params.get('conn'), params.get('placeId'), db_instance
            )
        else:
            raise Exception(f"INVALID_OPERATION: Operation {operation} not supported")
        
        return {
            'statusCode': 200,
            'body': json.dumps({'message': 'Operation completed successfully'}, default=str)
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

```

### Notes:
1. **Query Structure**: All SQL queries are preserved exactly as in the JavaScript code, including table names (`CMS_CONTENT_SHARE`, `CMS_PLAYLIST`, etc.), column names (`SHARED_PUBLISHED`, `CONTENT_ID`), and conditions. Only the parameter placeholders were changed from `$1`, `$2`, `$3` to `%s` for `psycopg2`.
2. **Database**: Uses `psycopg2` with `RealDictCursor` to return dictionary-like rows, mimicking the original `dbService.updateRow` behavior. The `conn` parameter is used if provided; otherwise, a new cursor is created from `db_instance`.
3. **Shared Status Functions**: `getSharedStatusByPlaylistId` and `getSharedStatusByProgramId` are placeholders returning `{"isShared": False, "originalPlaceId": ""}`. Replace with actual implementations to fetch shared status from the database or another service.
4. **Type Constants**: Defined as `Type.CONTENT = 'CONTENT'` and `Type.PLAYLIST = 'PLAYLIST'` to match the original hardcoded strings.
5. **Logging**: Uses Python's `logging` module, with messages formatted to match the original, including the `[PublishingService]` prefix and error details.
6. **Error Handling**: Exceptions are caught, logged, and re-raised, preserving the original behavior. The Lambda handler returns a 500 status code with the error message.
7. **Connection Management**: Commits changes if a `conn` is provided, assuming the caller manages the transaction. If `conn` is `None`, operations are executed within a single transaction.
8. **Lambda Handler**: Routes to the appropriate function based on the `operation` field. The event structure expects `id`, `status`, `placeId`, and `conn` (optional). Example:
   ```json
   {
       "operation": "setPublishingByPlaylistId",
       "params": {
           "id": "123e4567-e89b-12d3-a456-426614174000",
           "status": true,
           "placeId": "place123",
           "conn": null
       }
   }
   ```
9. **Dependencies**: Requires `psycopg2-binary` in the Lambda environment. Include it in the deployment package or a Lambda layer.
10. **Async**: Functions are marked `async` to match the JavaScript code, but `psycopg2` operations are synchronous. For async operations, consider `asyncpg`, though this would deviate from minimal changes.

### Usage Example:
To invoke the Lambda function for `setPublishingByPlaylistId`:
```json
{
    "operation": "setPublishingByPlaylistId",
    "params": {
        "id": "123e4567-e89b-12d3-a456-426614174000",
        "status": true,
        "placeId": "place123",
        "conn": null
    }
}
```

### Limitations:
- **Shared Status Functions**: The placeholder implementations for `getSharedStatusByPlaylistId` and `getSharedStatusByProgramId` always return `{"isShared": False, "originalPlaceId": ""}`, which means the `isShared` branch is never executed. Replace with actual logic to check shared status.
- **Database Credentials**: Update `get_db_connection` with actual PostgreSQL credentials, preferably stored in AWS Secrets Manager.
- **Connection Handling**: The `conn` parameter assumes an existing `psycopg2` connection. If passed from another function, ensure it’s compatible.
- **SQL Injection**: Table and column names are hardcoded, avoiding injection risks. Parameterized queries prevent injection in values.

If you need the `getSharedStatusByPlaylistId` and `getSharedStatusByProgramId` functions implemented, or if you have specific requirements (e.g., different handler structure, additional error handling, or actual shared status logic), please provide more details, and I can refine the code further!

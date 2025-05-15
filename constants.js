[Gulshan Bhati] 05-15-2025 11:27
{
"operation": "get_screens_filter_by_state",
"data": "Hello, World!",
"key": "32bytekey1234567890123456789012",
"iv": "1234567890abcdef1234567890abcdef",
"notification":{"messageId":"f765c5f8-d7f8-4189-821b-5720f4c1a509",
"functionName":"VX_SID_CMS_CCAUG_MULTI_CONTROL",
"path":"COM_SID_SCREEN > VX_SID_CMS_CCAUG_LIST > VX_SID_CMS_CCAUG_MULTI_CONTROL",
"type":"SCREEN","state":"READY","publishType":"PUBLISHING",
"target":{"userId":"61270D64-D394-45F5-B6F9-E9997344335F",
"workspaceId":"B010A998-9384-46CC-BAE1-AAFEDF0C4442",
"organizationId":"1D93E851-87C7-4D0C-8100-57108566325B"},
"createdTime":"2025-05-14T11:49:45.474Z",
"screens":[{"screenId":"8c-b0-e9-48-cc-d6","state":"READY"}],"errorMsg":""
},
"screens":["8c-b0-e9-48-cc-d6"],"type":"set",
"set":{"data":[{"name":"Location","value":"Delhi"}]}
} def get_screens_filter_by_state(self, screens, notification, type=None, set_data=None):
return_screens = []
fail_list = []
fail_message_list = []
groups = [screens[i:i + self.MAX_GROUP_COUNT] for i in range(0, len(screens), self.MAX_GROUP_COUNT)]

include_power_on = self.is_include_power_on(set_data) if set_data else False
include_display_orientation = self.is_include_orientation(set_data) if set_data else False

for group in groups:
rows = self.get_screens([s['screen_id'] for s in group]) import json
import os
import logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)
from dmsService import DMSService
from databaseService import DatabaseService

def lambda_handler(event, context):
try:
if not isinstance(event, dict):
return {
'statusCode': 400,
'body': json.dumps({'error': 'Invalid event format'})
}

operation = "get_screens_filter_by_state"
if not operation:
return {
'statusCode': 400,
'body': json.dumps({'error': 'Missing operation'})
}

db = DatabaseService.getinstance({
"host" :" ###",
"database": "###",
"user": "postgres",
"password":"######",
"port":5432
})

service = DMSService.get_instance({
'db': db,
'notification_sqs_url': os.environ.get('NOTIFICATION_SQS_URL'),
'logger': logger,
'region': os.environ.get('REGION', 'ap-southeast-1')
})

if operation == 'get_screens_filter_by_state':
screens = event.get('screens', [])
print("Screens check ",screens)
notification = event.get('notification')
type = event.get('type')
set_data = event.get('set')
if not screens or not notification:
return {
'statusCode': 400,
'body': json.dumps({'error': 'Missing screens or notification'})
}
{
                'statusCode': 200,
                'body': json.dumps({'result': result})
            }

[Gulshan Bhati] 05-15-2025 11:28
Response:
{
  "statusCode": 500,
  "body": "{\"error\": \"Internal server error: string indices must be integers\"}"
}

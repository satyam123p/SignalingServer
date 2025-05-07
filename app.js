
import os
import json
import boto3
from datetime import datetime
from botocore.exceptions import ClientError

# Conditionally import AWS X-Ray SDK
try:
    from aws_xray_sdk.core import xray_recorder
    from aws_xray_sdk.ext.boto import patch as xray_patch
    XRAY_ENABLED = True
except ImportError:
    XRAY_ENABLED = False

# Configure X-Ray if enabled and not in 'k8s' environment
ENV = os.environ.get('NODE_ENV', os.environ.get('ENV', 'lambda'))
if XRAY_ENABLED and ENV != 'k8s':
    xray_patch(('boto3',))
    xray_recorder.configure(streaming_threshold=0)

class CloudWatchService:
    def __init__(self, log_group):
        """
        Initialize CloudWatchService with a CloudWatch Logs client and log group.
        
        Args:
            log_group (str): The name of the CloudWatch Logs log group.
        """
        self.cloudwatch_logs = boto3.client('logs', api_version='2014-03-28')
        self.log_group = log_group

    async def is_exists_log_stream(self):
        """
        Check if a log stream for today exists in the log group.
        
        Returns:
            bool: True if the log stream exists, False otherwise.
        """
        try:
            log_stream = self.today()
            params = {
                'logGroupName': self.log_group,
                'limit': 1,
                'logStreamNamePrefix': log_stream
            }
            result = self.cloudwatch_logs.describe_log_streams(**params)
            return bool(result.get('logStreams', []))
        except ClientError as e:
            raise RuntimeError(f"Error checking log stream: {str(e)}")

    async def create_log_stream(self):
        """
        Create a log stream for today in the log group.
        
        Returns:
            dict: The response from CloudWatch Logs.
        """
        try:
            stream_name = self.today()
            params = {
                'logGroupName': self.log_group,
                'logStreamName': stream_name
            }
            return self.cloudwatch_logs.create_log_stream(**params)
        except ClientError as e:
            raise RuntimeError(f"Error creating log stream: {str(e)}")

    async def write_log(self, message):
        """
        Write a log message to the log stream for today, creating the stream if it doesn't exist.
        
        Args:
            message (str): The log message to write.
        
        Returns:
            dict: The response from CloudWatch Logs.
        """
        try:
            if not await self.is_exists_log_stream():
                await self.create_log_stream()
            
            stream_name = self.today()
            params = {
                'logEvents': [
                    {
                        'message': message,
                        'timestamp': int(datetime.now().timestamp() * 1000)
                    }
                ],
                'logGroupName': self.log_group,
                'logStreamName': stream_name
            }
            return self.cloudwatch_logs.put_log_events(**params)
        except ClientError as e:
            raise RuntimeError(f"Error writing log: {str(e)}")

    def today(self):
        """
        Generate a date string for today in YYYY-MM-DD format.
        
        Returns:
            str: The date string.
        """
        date = datetime.now()
        return f"{date.year}-{date.month:02d}-{date.day:02d}"

def lambda_handler(event, context):
    """
    AWS Lambda handler for CloudWatch Logs operations.
    
    Args:
        event (dict): The input event containing operation, log group, and message.
        context (object): The Lambda context object.
    
    Returns:
        dict: Response with statusCode and body (JSON string).
    """
    try:
        # Validate event
        if not isinstance(event, dict):
            return {
                'statusCode': 400,
                'body': json.dumps({'error': 'Invalid event format'})
            }
        
        operation = event.get('operation')
        log_group = event.get('log_group')
        
        if not operation:
            return {
                'statusCode': 400,
                'body': json.dumps({'error': 'Missing operation'})
            }
        
        if not log_group:
            return {
                'statusCode': 400,
                'body': json.dumps({'error': 'Missing log_group'})
            }
        
        # Initialize CloudWatchService
        service = CloudWatchService(log_group)
        
        # Handle operations
        if operation == 'write_log':
            message = event.get('message')
            if not message:
                return {
                    'statusCode': 400,
                    'body': json.dumps({'error': 'Missing message for write_log'})
                }
            result = service.write_log(message)
            return {
                'statusCode': 200,
                'body': json.dumps({'result': 'Log written successfully'})
            }
        
        elif operation == 'create_log_stream':
            result = service.create_log_stream()
            return {
                'statusCode': 200,
                'body': json.dumps({'result': 'Log stream created successfully'})
            }
        
        elif operation == 'is_exists_log_stream':
            exists = service.is_exists_log_stream()
            return {
                'statusCode': 200,
                'body': json.dumps({'result': exists})
            }
        
        else:
            return {
                'statusCode': 400,
                'body': json.dumps({'error': f'Invalid operation: {operation}'})
            }
    
    except Exception as e:
        return {
            'statusCode': 500,
            'body': json.dumps({'error': f'Internal server error: {str(e)}'})
        }






const AWSXRay = require('aws-xray-sdk');
AWSXRay.setStreamingThreshold(0);
const AWS = (process.env.NODE_ENV == 'k8s') ? require('aws-sdk') : AWSXRay.captureAWS(require('aws-sdk'));

class CloudWatchService {
    constructor(logGroup) {
        this.cloudWatchLogs = new AWS.CloudWatchLogs({ apiVersion: '2014-03-28' });
        this.logGroup = logGroup;
    }

    isExistsLogStream = async () => {
        const logStream = this.today();
        const params = {
            logGroupName: this.logGroup,
            limit: 1,
            logStreamNamePrefix: logStream,
        };
        const result = await this.cloudWatchLogs.describeLogStreams(params).promise();
        return result && result.logStreams && result.logStreams.length > 0;
    };

    createLogStream = async () => {
        const streamName = this.today();
        const params = {
            logGroupName: this.logGroup,
            logStreamName: streamName,
        };
        return await this.cloudWatchLogs.createLogStream(params).promise();
    };

    writeLog = async (message) => {
        const result = await this.isExistsLogStream();
        if (!result) {
            await this.createLogStream();
        }

        const streamName = this.today();
        const params = {
            logEvents: [
                {
                    message: message,
                    timestamp: Date.now(),
                },
            ],
            logGroupName: this.logGroup,
            logStreamName: streamName,
        };
        await this.cloudWatchLogs.putLogEvents(params).promise();
    };

    today = () => {
        const date = new Date();
        return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
    };
}
module.exports = CloudWatchService;

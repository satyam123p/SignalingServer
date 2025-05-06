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

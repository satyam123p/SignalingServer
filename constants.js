Response:
{
  "statusCode": 500,
  "body": "{\"error\": \"DynamoDB scan failed: An error occurred (ValidationException) when calling the Scan operation: Invalid FilterExpression: Attribute name is a reserved keyword; reserved keyword: status\"}"
}

Function Logs:
START RequestId: 8744bc28-3993-423e-9bc1-3057c8abaedd Version: $LATEST
[ERROR]	2025-04-29T11:30:51.697Z	8744bc28-3993-423e-9bc1-3057c8abaedd	Error processing action scan: DynamoDB scan failed: An error occurred (ValidationException) when calling the Scan operation: Invalid FilterExpression: Attribute name is a reserved keyword; reserved keyword: status
END RequestId: 8744bc28-3993-423e-9bc1-3057c8abaedd
REPORT RequestId: 8744bc28-3993-423e-9bc1-3057c8abaedd	Duration: 148.97 ms	Billed Duration: 149 ms	Memory Size: 128 MB	Max Memory Used: 86 MB

Request ID: 8744bc28-3993-423e-9bc1-3057c8abaedd

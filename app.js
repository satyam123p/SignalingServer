
class DatabaseService:

    @staticmethod
    def getinstance(params):
        instanceName = params.get('instanceName', 'default')
        rw = params.get('rw', 'w')
        dbInstanceName = f"{instanceName}_{rw}"
        if dbInstanceName not in _instances:
            _instances[dbInstanceName] = DatabaseService(params)
        return _instances[dbInstanceName]

    def __init__(self, params):
        user = params.get('user')
        password = params.get('password')
        host = params.get('host')
        readerHost = params.get('readerHost')
        port = params.get('port')
        database = params.get('database')
        region = params.get('region')
        secretManagerName = params.get('secretManagerName')
        ssl = params.get('ssl')
        logLevel = params.get('logLevel', 'error')
        rw = params.get('rw', 'w')
        applicationName = params.get('applicationName')
        release = params.get('release', False)

        processName = os.environ.get('AWS_LAMBDA_FUNCTION_NAME') or os.environ.get('SERVICE_NAME')
        if not applicationName and processName:
            timestamp = datetime.now().isoformat()
            if os.environ.get('ECS') == 'true':
                applicationName = f"[NODE] {processName} {timestamp}"
            else:
                applicationName = f"[LAMBDA] {processName} {timestamp}"

        if not applicationName:
            raise ValueError('applicationName is required for database service.')

        self.secretManagerName = secretManagerName if secretManagerName else None
        self.secretManagerRegion = region if region else None
        self.user = user if user else None
        self.password = password if password else None 
        self.host = host if host else None
        self.readerHost = readerHost if readerHost else None
        self.database = database if database else None
        self.port = port if port else None
        self.region = region
        self.ssl = ssl
        self.applicationName = applicationName
        self.logInfo = logLevel.lower() == 'info'
        self.engine = None 
        self.rw = rw
        self.release = release 
        self.regex = re.compile(r'^[a-zA-Z0-9_:-]+$')

        if self.logInfo:
            logger.setLevel(logging.INFO)
        else:
            logger.setLevel(logging.ERROR)

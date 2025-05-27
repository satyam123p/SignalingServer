if (!isNil(OpenApiToken)) {
                logger.info('[OpenApiRequest]');
                const openApiOrg = req.header('organizationId');
                const openApiApp = req.header('appId');
                if (!openApiOrg || !openApiApp) {
                    logger.error('[ERROR]: Missing Organization Id or App Id in header');
                    throw new Error('Unauthorized');
                }
                const redisOpenApiKey = 'OpenApi_' + openApiOrg + '_' + openApiApp;
                const tokenFromRedis = await redisService.get(redisOpenApiKey);
                if (!tokenFromRedis || tokenFromRedis !== OpenApiToken) {
                    logger.error('[ERROR]: OpenAPI token mismatch or not found');
                    throw new Error('Unauthorized');
                }
                next();
                return;
            } convert it into python

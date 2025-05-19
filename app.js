const { handleError, isValidUUID, isTagValid } = require('@fcms/common/service/util.service');
const { HTTP_STATUS_CODES } = require('@fcms/common/const/common-const');
const { logger } = require('@fcms/common/service/logger.service');
const { encrypt } = require('@fcms/common/service/dkms.service');
const APIRequestService = require('./apirequest.service');
const { isNil, isEmpty } = require('lodash');

const getTags = async (tableName, columnName, categoryName, id, dbInstance) => {
    logger.info(`[getTags API][tableName = ${tableName}][columnName = ${columnName}][categoryName = ${categoryName}]`);
    try {
        if (categoryName !== 'screen') {
            await isValidUUID(id, `${categoryName}Id`);
        }
        const tagsData = await dbInstance.selectRows({
            text: `SELECT * FROM ${tableName} WHERE ${columnName} = $1`,
            values: [id],
        });
        logger.info(`[API][${categoryName.toUpperCase()}][TAGS] : `, JSON.stringify(tagsData));
        return tagsData.length ? tagsData : [];
    } catch (e) {
        logger.error(`[API][${categoryName.toUpperCase()}][TAGS]`, e);
        throw e;
    }
};

const addTags = async (tableName, tagTableName, columnName, categoryName, responseService, dbInstance, userEmail, userName, { columnId = '' } = {}, conn = false) => {
    logger.info(`[addTags API][tableName = ${tableName}][tagTableName = ${tagTableName}][columnName = ${columnName}][categoryName = ${categoryName}]`);

    // let conn;
    let newTransaction = true;
    if (conn) {
        newTransaction = false;
    }
    try {
        if (newTransaction) {
            conn = await dbInstance.startTransaction();
        }
        let { id } = responseService.pathParameters;

        if (!id) {
            id = columnId;
        }

        if (categoryName !== 'screen') await isValidUUID(id, `${categoryName}Id`);

        const data = responseService.body;
        if (!data || !data.tags || data.tags.length === 0) {
            throw handleError('INSUFFICIENT_REQUIRED_PARAMETERS', 'Tags are missing');
        }

        for (let tag of data.tags) {
            await isTagValid(tag);
            const { tagName, tagId, color, tagsetCategoryId, categoryName: tagsetCategoryName, tagKey, tagsetCategoryKey } = tag;

            if (isEmpty(tagKey) || tagKey.length < 36) {
                throw handleError('INSUFFICIENT_REQUIRED_PARAMETERS', 'tagKey is missing');
            } else if (isEmpty(tagsetCategoryKey) || tagsetCategoryKey.length < 36) {
                throw handleError('INSUFFICIENT_REQUIRED_PARAMETERS', 'tagsetCategoryKey is missing');
            } else if (isEmpty(tagsetCategoryName)) {
                throw handleError('INSUFFICIENT_REQUIRED_PARAMETERS', 'categoryName is missing');
            } else if (isNil(tagsetCategoryId)) {
                throw handleError('INSUFFICIENT_REQUIRED_PARAMETERS', 'tagsetCategoryId is missing');
            } else if (isNil(tagId)) {
                throw handleError('INSUFFICIENT_REQUIRED_PARAMETERS', 'tagId is missing');
            } else if (isEmpty(tagName)) {
                throw handleError('INSUFFICIENT_REQUIRED_PARAMETERS', 'tagName is missing');
            }

            let tags;
            try {
                tags = await dbInstance.selectRows(
                    {
                        text: `SELECT TAG_ID FROM ${tagTableName} WHERE ${columnName} = $1 AND TAG_ID = $2`,
                        values: [id, tagId],
                    },
                    conn,
                );
            } catch (error) {
                logger.error(error);
                throw handleError('INTERNAL_SERVER_ERROR', `fail to select ${categoryName} tag`);
            }
            if (tags && tags.length === 0) {
                const result = await dbInstance.insertRow(
                    {
                        table: tagTableName,
                        columnsValues: {
                            [columnName]: id,
                            TAG_NAME: tagName,
                            TAG_ID: tagId,
                            COLOR: color,
                            TAGSET_CATEGORY_ID: tagsetCategoryId,
                            TAGSET_CATEGORY_NAME: tagsetCategoryName,
                            TAG_KEY: tagKey,
                            TAGSET_CATEGORY_KEY: tagsetCategoryKey,
                        },
                    },
                    conn,
                );
                if (!(result && result.rowCount && result.rowCount === 1)) {
                    throw handleError('INTERNAL_SERVER_ERROR', `fail to insert ${categoryName}  tag`);
                }
            }
        }

        try {
            const encryptedUserEmail = await encrypt(userEmail, 'email');
            const encryptedUserName = await encrypt(userName, 'name');

            const columnsValues = {
                UPDATER_ID: encryptedUserEmail,
                UPDATER_NAME: encryptedUserName,
            };

            if (tableName === 'DMS_SCREEN') {
                columnsValues['CHANGED_TIME'] = 'NOW()';
            } else {
                columnsValues['UPDATED_TIME'] = 'NOW()';
            }

            await dbInstance.updateRow({
                table: tableName,
                columnsValues,
                wheres: {
                    [columnName]: id,
                },
            }, conn);
        } catch (error) {
            logger.error(error);
            throw handleError('INTERNAL_SERVER_ERROR', `fail to update ${categoryName} `);
        }

        if (newTransaction) {
            await dbInstance.commitTransaction(conn);
        }
    } catch (error) {
        if (newTransaction) {
            await dbInstance.rollbackTransaction(conn);
        }
        logger.error(`[API][${categoryName.toUpperCase()}][TAGS]`, error.message);
        throw error;
    } finally {
        if (newTransaction) {
            await dbInstance.endTransaction(conn);
        }
    }
};

const deleteTags = async (tableName, tagTableName, columnName, categoryName, responseService, dbInstance, userEmail, userName, lambdaService, cookies, isCrossService = false, openApiHeaders = {}) => {
    logger.info(`[deleteTags API][tableName = ${tagTableName}][columnName = ${columnName}][categoryName = ${categoryName}]`);
    let conn;
    let resultData;
    let invokeData;
    const apiRequestService = new APIRequestService();
    try {
        const { organizationId, placeId, id, tagId } = responseService.pathParameters;
        conn = await dbInstance.startTransaction();
        await isValidUUID(organizationId, 'organizationId');
        await isValidUUID(placeId, 'placeId');
        if (categoryName !== 'screen') await isValidUUID(id, `${categoryName}Id`);

        let tagIds = [];

        if (tagId) {
            tagIds = [tagId];
        } else if (responseService?.body?.tags && Array.isArray(responseService.body.tags)) {
            tagIds = responseService.body.tags.map(tag => tag.tagId);
        }

        if (!tagIds.length) {
            throw handleError('INSUFFICIENT_REQUIRED_PARAMETERS', 'tagId value is missing in input');
        }

        for (const tagId of tagIds) {
            if (!tagId || !Number(tagId)) {
                throw handleError('INSUFFICIENT_REQUIRED_PARAMETERS', 'tagId value is missing in input');
            }
        }
        const payload = {
            pathParameters: {
                organizationId: organizationId,
                placeId: placeId,
            },
            body: {
                tagIds: tagIds.join(','),
                type: categoryName,
                typeId: id,
            },
            headers: openApiHeaders,
        };

        try {
            if (isCrossService) {
                invokeData = await apiRequestService.invoke('DELETE_TAG_RELATION', payload, 'DELETE', cookies, logger.getLogContext() ?? undefined);
            } else {
                invokeData = await lambdaService.invokeAndGetPayload('DELETE_TAG_RELATION', payload, logger.getLogContext() ?? undefined);
            }
            logger.info(`invokeStatusCode: ${invokeData.statusCode}`);
        } catch (e) {
            logger.error(e.message);
            throw handleError('INTERNAL_SERVER_ERROR', `Fail to delete ${categoryName} tag relation : Lambda invoke error`);
        }

        if (invokeData.statusCode === HTTP_STATUS_CODES.HTTP_OK) {
            const result = await dbInstance.deleteRows({
                text: `DELETE FROM ${tagTableName} WHERE 1 = 1 AND ${columnName} = $1 AND TAG_ID IN (${tagIds.map((t, index) => `$${Number(index + 2)}`).join(',')})`,
                values: [id, ...tagIds],
            }, conn);

            if (result && result.rowCount && result.rowCount === 1) {
                resultData = result;

                try {
                    const encryptedUserEmail = await encrypt(userEmail, 'email');
                    const encryptedUserName = await encrypt(userName, 'name');

                    const columnsValues = {
                        UPDATER_ID: encryptedUserEmail,
                        UPDATER_NAME: encryptedUserName,
                    };

                    if (tableName === 'DMS_SCREEN') {
                        columnsValues['CHANGED_TIME'] = 'NOW()';
                    } else {
                        columnsValues['UPDATED_TIME'] = 'NOW()';
                    }

                    await dbInstance.updateRow({
                        table: tableName,
                        columnsValues,
                        wheres: {
                            [columnName]: id,
                        },
                    }, conn);
                } catch (error) {
                    console.error(error);
                    logger.error(error);
                    throw handleError('INTERNAL_SERVER_ERROR', `fail to update ${categoryName} `);
                }
            } else {
                // throw handleError("INTERNAL_SERVER_ERROR", `Fail to delete ${categoryName} tag`);
            }
        } else {
            throw handleError('INTERNAL_SERVER_ERROR', `Fail to delete ${categoryName} tags`);
        }
    } catch (error) {
        logger.error(`[API][${categoryName.toUpperCase()}][TAGS]`, error.message);
        await dbInstance.rollbackTransaction(conn);
        throw error;
    } finally {
        await dbInstance.endTransaction(conn);
    }
    await dbInstance.commitTransaction(conn);
    return resultData;
};

const updateTags = async (tableName, columnName, tagTableName, responseService, dbInstance, callerName = 'update tag') => {
    let result;
    let conn;
    let { organizationId } = responseService.pathParameters;
    const { action, newTagName, newTagsetCategoryName, newColor, tagName, tagsetCategoryName, placeIds = [] } = responseService.body;
    logger.info(`[API][${callerName.toUpperCase()}][TAGS] [Request Body] : `, JSON.stringify(responseService.body));
    try {
        conn = await dbInstance.startTransaction();

        if (placeIds != 'all' && placeIds.length <= 0) {
            throw handleError('INSUFFICIENT_REQUIRED_PARAMETERS', 'placeIds is required.');
        }

        if (!tagsetCategoryName || tagsetCategoryName == '') {
            throw handleError('INSUFFICIENT_REQUIRED_PARAMETERS', 'tagsetCategoryName is required.');
        }
        switch (action) {
            case 'CHANGE_TAG_NAME':
                if (!tagName || tagName == '') {
                    throw handleError('INSUFFICIENT_REQUIRED_PARAMETERS', 'tagName is required.');
                }
                if (!newTagName || newTagName == '') {
                    throw handleError('INSUFFICIENT_REQUIRED_PARAMETERS', 'newTagName is required.');
                }
                break;
            case 'CHANGE_CATEGORY_NAME':
                if (!newTagsetCategoryName || newTagsetCategoryName == '') {
                    throw handleError('INSUFFICIENT_REQUIRED_PARAMETERS', 'newTagsetCategoryName is required.');
                }
                break;
            case 'CHANGE_CATEGORY_COLOR':
                if (isNil(newColor) || newColor === '') {
                    throw handleError('INSUFFICIENT_REQUIRED_PARAMETERS', 'newColor is required.');
                }
                break;
            case 'CHANGE_CATEGORY':
                if (!tagName || tagName == '') {
                    throw handleError('INSUFFICIENT_REQUIRED_PARAMETERS', 'tagName is required.');
                }
                if (!newTagsetCategoryName || newTagsetCategoryName == '') {
                    throw handleError('INSUFFICIENT_REQUIRED_PARAMETERS', 'newTagsetCategoryName is required.');
                }
                if (isNil(newColor) || newColor === '') {
                    throw handleError('INSUFFICIENT_REQUIRED_PARAMETERS', 'newColor is required.');
                }
                break;
            default:
                throw handleError('INVALID_PARAMETER_VALUE', `${action} is not supported for action.`);
        }

        const placeIdArray = placeIds === 'all' ? organizationId : placeIds.map(u => '\'' + u + '\'');
        const queryConditionPlaceIds
      = placeIds === 'all'
          ? `${columnName} IN (SELECT ${columnName} FROM ${tableName} WHERE ORGANIZATION_ID = '${organizationId}')`
          : `${columnName} IN (SELECT ${columnName} FROM ${tableName} WHERE PLACE_ID IN (${placeIdArray.join(',')}))`;
        logger.info('queryConditionPlaceIds', queryConditionPlaceIds);
        let updateQuery; // update tag category

        switch (action) {
            case 'CHANGE_TAG_NAME':
                /* Tag Name - newTagName, where : placeId, tagName, categoryName */
                logger.info('Tag name changed', 'newTag:', newTagName, 'tag:', tagName, 'category:', tagsetCategoryName, placeIdArray);
                updateQuery = {
                    table: tagTableName,
                    columnsValues: {
                        TAG_NAME: newTagName,
                    },
                    wheres: {
                        'TAG_NAME': tagName,
                        'TAGSET_CATEGORY_NAME': tagsetCategoryName,
                        '@1': queryConditionPlaceIds,
                    },
                };
                break;
            case 'CHANGE_CATEGORY_NAME':
                /* Change CategoryName - newTagsetCategoryName, where : placeId, categoryName */
                logger.info('tagsetCategoryName changed', 'newCategory:', newTagsetCategoryName, 'category:', tagsetCategoryName, placeIdArray);
                updateQuery = {
                    table: tagTableName,
                    columnsValues: {
                        TAGSET_CATEGORY_NAME: newTagsetCategoryName,
                    },
                    wheres: {
                        'TAGSET_CATEGORY_NAME': tagsetCategoryName,
                        '@1': queryConditionPlaceIds,
                    },
                };
                break;
            case 'CHANGE_CATEGORY':
                /* category of the tag - newColor, newTagsetCategoryName, where : placeId, tagName, tagsetCategoryName */
                logger.info('category changed', 'color:', newColor, 'newCategory:', newTagsetCategoryName, 'tag:', tagName, 'categoryName:', tagsetCategoryName, placeIdArray);
                updateQuery = {
                    table: tagTableName,
                    columnsValues: {
                        TAGSET_CATEGORY_NAME: newTagsetCategoryName,
                        COLOR: newColor,
                    },
                    wheres: {
                        'TAG_NAME': tagName,
                        'TAGSET_CATEGORY_NAME': tagsetCategoryName,
                        '@1': queryConditionPlaceIds,
                    },
                };
                break;
            case 'CHANGE_CATEGORY_COLOR':
                /* color - newColor, where : placeId, categoryName */
                logger.info('Tag Color changed', 'color:', newColor, 'category:', tagsetCategoryName, placeIdArray);
                updateQuery = {
                    table: tagTableName,
                    columnsValues: {
                        COLOR: newColor,
                    },
                    wheres: {
                        'TAGSET_CATEGORY_NAME': tagsetCategoryName,
                        '@1': queryConditionPlaceIds,
                    },
                };
                break;
            default:
                throw handleError('INVALID_PARAMETER_VALUE', `${action} is not supported.`);
        }

        try {
            result = await dbInstance.updateRow(updateQuery, conn);
        } catch (error) {
            logger.error(error);
            throw handleError('INTERNAL_SERVER_ERROR', `Failed to update tag for ${callerName}.`);
        }
        await dbInstance.commitTransaction(conn);
    } catch (error) {
        await dbInstance.rollbackTransaction(conn);
        logger.error(`[ERROR][API][${callerName.toUpperCase()}][TAGS]`, error);
        throw error;
    } finally {
        await dbInstance.endTransaction(conn);
    }
    return result;
};

const deleteTagByCategory = async (tableName, columnName, tagTableName, responseService, dbInstance, callerName = 'delete tag') => {
    logger.info(`[API][${callerName.toUpperCase()}][TAGS] [Request Body] : `, JSON.stringify(responseService.body));
    try {
        let { organizationId } = responseService.pathParameters;
        let { tagNames = [], placeIds = [], tagsetCategoryName } = responseService.body || {};
        if (placeIds !== 'all' && placeIds.length <= 0) {
            throw handleError('INSUFFICIENT_REQUIRED_PARAMETERS', 'placeIds is required.');
        }

        if (!tagNames || !tagsetCategoryName) {
            throw handleError('INSUFFICIENT_REQUIRED_PARAMETERS', 'tagNames and tagsetCategoryName are required.');
        }
        if (tagNames != 'all' && tagNames.length <= 0) {
            throw handleError('INSUFFICIENT_REQUIRED_PARAMETERS', 'tagNames is required.');
        }

        let query;

        if (tagNames != 'all') {
            tagNames = tagNames.map(name => '\'' + name + '\'');
            query = `DELETE FROM ${tagTableName} WHERE TAGSET_CATEGORY_NAME = $1 AND TAG_NAME IN (${tagNames.join(',')}) AND
            ${columnName} IN (SELECT ${columnName} FROM ${tableName} WHERE `;
        } else {
            query = `DELETE FROM ${tagTableName} WHERE TAGSET_CATEGORY_NAME = $1 AND
            ${columnName} IN (SELECT ${columnName} FROM ${tableName} WHERE `;
        }

        if (placeIds !== 'all') {
            placeIds = placeIds.map(placeId => '\'' + placeId + '\'');
            query += `PLACE_ID IN (${placeIds.join(',')}))`;
        } else {
            query += `ORGANIZATION_ID = '${organizationId}')`;
        }

        const deleted = await dbInstance.deleteRows({
            text: query,
            values: [tagsetCategoryName],
            returning: '*',
        });
        logger.info('deleted', deleted, tagsetCategoryName);
        if (deleted && deleted.length > 0) {
            return deleted;
        }
    } catch (error) {
        logger.error(`[ERROR][API][${callerName.toUpperCase()}][TAGS]`, error);
        throw error;
    }
};

// eslint-disable-next-line
const copyTags = async (id, newId, tagTableName, columnName, dbInstance, conn, callerName) => {
    if (!dbInstance) {
        throw handleError('INTERNAL_SERVER_ERROR', 'Database Object Not Defined');
    }

    let tags;
    try {
        tags = await dbInstance.selectRows(
            {
                query: `SELECT * FROM ${tagTableName} WHERE ${columnName} = $1`,
                values: [id],
            },
            conn,
        );
        logger.info('tags', tags);
    } catch (error) {
        logger.error(error);
        throw handleError('INTERNAL_SERVER_ERROR', `Failed to get tags from tag table`);
    }

    await Promise.all(
        tags.map(async (tag) => {
            try {
                await dbInstance.insertRow(
                    {
                        table: tagTableName,
                        columnsValues: {
                            [columnName]: newId,
                            TAG_ID: tag.tagId,
                            TAG_NAME: tag.tagName,
                            COLOR: tag.color,
                            TAGSET_CATEGORY_ID: tag.tagsetCategoryId,
                            TAGSET_CATEGORY_NAME: tag.tagsetCategoryName,
                            TAG_KEY: tag.tagKey,
                            TAGSET_CATEGORY_KEY: tag.tagsetCategoryKey,
                        },
                    },
                    conn,
                );
            } catch (error) {
                logger.error(error);
                throw handleError('INTERNAL_SERVER_ERROR', `Failed to insert tags to tag table`);
            }
        }),
    );
};

const getSystemTags = async (target, dbInstance, workspaceId) => {
    try {
        const systemTagQuery = `SELECT SYSTEM_TAG.*, RELATION.VALUE,
            CASE WHEN IS_USED IS NULL THEN FALSE ELSE IS_USED END FROM UMS_SYSTEM_TAG SYSTEM_TAG
            LEFT JOIN (SELECT *, CAST('TRUE' AS BOOLEAN) AS IS_USED FROM UMS_PLACE_RELATION_SYSTEM_TAG WHERE PLACE_ID = $2) AS RELATION
            ON SYSTEM_TAG.SYSTEM_TAG_ID = RELATION.SYSTEM_TAG_ID
            WHERE TARGET = $1`;

        const systemTags = await dbInstance.selectRows({
            query: systemTagQuery,
            values: [target, workspaceId],
        });
        return systemTags;
    } catch (error) {
        logger.error(`[GET-SYSTEM-TAGS][ERROR] ${error.message}, [STACK] ${error.stack}`);
        throw error;
    }
};

const getSystemTagsByKeys = async (tagKeys, dbInstance, target) => {
    const query = `SELECT * FROM UMS_SYSTEM_TAG WHERE TARGET = $1 AND KEY IN (${tagKeys.map((t, index) => `$${Number(index + 2)}`)})`;
    const values = [target, ...tagKeys];
    return await dbInstance.selectRows({ query, values });
};

const isExistsTagDataInWorkspace = async (dbInstance, type, tagDataIds, workspaceId) => {
    let query = '';
    switch (type) {
        case 'TAG_ID': {
            query = `SELECT TAGSET.TAGSET_ID, CATEGORY.TAGSET_CATEGORY_ID, TAG.TAG_ID, TAG.TAG_NAME, TAGSET.IS_GLOBAL FROM AMS_PLACE_RELATION_TAGSET RELATION
              INNER JOIN AMS_TAGSET TAGSET ON TAGSET.TAGSET_ID = RELATION.TAGSET_ID
              INNER JOIN AMS_TAGSET_CATEGORY CATEGORY ON TAGSET.TAGSET_ID = CATEGORY.TAGSET_ID
              RIGHT JOIN AMS_TAG TAG ON CATEGORY.TAGSET_CATEGORY_ID = TAG.TAGSET_CATEGORY_ID
              WHERE RELATION.PLACE_ID = $1 AND TAG.TAG_ID IN (${tagDataIds.map((t, index) => `$${Number(index + 2)}`)})
              UNION
              SELECT TAGSET.TAGSET_ID, CATEGORY.TAGSET_CATEGORY_ID, TAG.TAG_ID, TAG.TAG_NAME, TAGSET.IS_GLOBAL FROM AMS_TAGSET TAGSET
              INNER JOIN AMS_TAGSET_CATEGORY CATEGORY ON TAGSET.TAGSET_ID = CATEGORY.TAGSET_ID
              RIGHT JOIN AMS_TAG TAG ON CATEGORY.TAGSET_CATEGORY_ID = TAG.TAGSET_CATEGORY_ID
              WHERE TAG.TAG_ID IN (${tagDataIds.map((t, index) => `$${Number(index + 2)}`)}) AND TAGSET.IS_GLOBAL = TRUE`;
            break;
        }
        case 'TAGSET_CATEGORY_ID': {
            query = `SELECT TAGSET.TAGSET_ID, CATEGORY.TAGSET_CATEGORY_ID, TAGSET.IS_GLOBAL FROM AMS_PLACE_RELATION_TAGSET RELATION
              INNER JOIN AMS_TAGSET TAGSET ON TAGSET.TAGSET_ID = RELATION.TAGSET_ID
              INNER JOIN AMS_TAGSET_CATEGORY CATEGORY ON TAGSET.TAGSET_ID = CATEGORY.TAGSET_ID
              WHERE RELATION.PLACE_ID = $1 AND CATEGORY.TAGSET_CATEGORY_ID IN (${tagDataIds.map((t, index) => `$${Number(index + 2)}`)})
              UNION
              SELECT TAGSET.TAGSET_ID, CATEGORY.TAGSET_CATEGORY_ID, TAGSET.IS_GLOBAL FROM AMS_TAGSET TAGSET
              INNER JOIN AMS_TAGSET_CATEGORY CATEGORY ON TAGSET.TAGSET_ID = CATEGORY.TAGSET_ID
              WHERE CATEGORY.TAGSET_CATEGORY_ID IN (${tagDataIds.map((t, index) => `$${Number(index + 2)}`)}) AND TAGSET.IS_GLOBAL = TRUE`;
            break;
        }
        case 'SYSTEM_TAG_ID': {
            query = `SELECT COALESCE(CUSTOM_SYSTEM_TAG.SYSTEM_TAG_ID, NOT_CUSTOM_SYSTEM_TAG.SYSTEM_TAG_ID) AS SYSTEM_TAG_ID
                    FROM (SELECT * FROM UMS_SYSTEM_TAG SYSTEM_TAG
                          WHERE SYSTEM_TAG.SYSTEM_TAG_ID IN (${tagDataIds.map((t, index) => `$${Number(index + 2)}`)}) AND TYPE != 'CUSTOM') AS NOT_CUSTOM_SYSTEM_TAG
                    FULL JOIN
                        (SELECT SYSTEM_TAG.* FROM UMS_SYSTEM_TAG SYSTEM_TAG
                            INNER JOIN UMS_PLACE_RELATION_SYSTEM_TAG RELATION ON SYSTEM_TAG.SYSTEM_TAG_ID = RELATION.SYSTEM_TAG_ID
                            WHERE PLACE_ID = $1 AND SYSTEM_TAG.SYSTEM_TAG_ID IN (${tagDataIds.map((t, index) => `$${Number(index + 2)}`)}) AND TYPE = 'CUSTOM') AS CUSTOM_SYSTEM_TAG
                    ON NOT_CUSTOM_SYSTEM_TAG.SYSTEM_TAG_ID = CUSTOM_SYSTEM_TAG.SYSTEM_TAG_ID`;
            break;
        }
        default: {
            break;
        }
    }
    const result = await dbInstance.selectRows({
        query: query,
        values: [workspaceId, ...tagDataIds],
    });
    if (!(result && result.length === tagDataIds.length)) return false;
    return true;
};

const TagsService = {
    addTags,
    deleteTags,
    getTags,
    updateTags,
    deleteTagByCategory,
    copyTags,
    getSystemTags,
    getSystemTagsByKeys,
    isExistsTagDataInWorkspace,
};

module.exports = TagsService;

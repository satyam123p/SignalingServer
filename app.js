query = f"DELETE FROM {tagTableName} WHERE TAGSET_CATEGORY_NAME = :1 AND TAG_NAME IN ({','.join(tagNames)}) AND {columnName} IN (SELECT {columnName} FROM  {tableName} WHERE "


query = (
        f"DELETE FROM {tag_table_name} WHERE TAGSET_CATEGORY_NAME = $1 "
        f"AND TAG_NAME IN ({', '.join(tag_names_quoted)}) "
        f"AND {column_name} IN (SELECT {column_name} FROM {table_name} WHERE "
    )
 both are same or different.

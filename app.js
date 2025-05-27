const authResult = accessControlList[method.toUpperCase()] ? accessControlList[method.toUpperCase()].some((api) => {
                            const urlMatch = match(api, { decode: decodeURIComponent });
                            let originalUrlWithoutQuery = originalUrl.split('?')[0];
                            return urlMatch(originalUrlWithoutQuery) != false;
                            })
                            : 
                            false;

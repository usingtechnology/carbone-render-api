## carbone-copy-app
Node Express application that provides an interface for generating documents from templates and data.  It provides a local file storage cache that means callers do not have to upload the template for each render.  Callers should should store cache keys/hashes and check if templates exist before generation.  

The most significant libraries used in this application are:
* [file-cache]()
* [carbone-render]()
* [carbone-copy-api]()

Please review their documentation.  

### important
This application will require LibreOffice installed - it requires LibreOffice to do pdf generation.  

See image: []().
  

### usage

### configuration
Configuration is set by environment variables.  


| Variable | Notes |
| --- | --- |
| CACHE_DIR | This is the root location to read/write files.  Error will be thrown if directory does not exist and cannot be created.  Default is operating system temp file location. |
| UPLOAD_FIELD_NAME | Field name for multipart form data upload when uploading templates via /template api.  Default is 'template' |
| UPLOAD_FILE_SIZE | Limit size of template files. Uses the [bytes](https://www.npmjs.com/package/bytes) library for parsing values.  Default is '25MB'|
| UPLOAD_FILE_COUNT | Limit the number of files uploaded per call.  Default is 1, not recommended to use any other value. |
| START_CARBONE | If true, then the carbone converter will be started on application start. This will ensure that the first call to /render will not incur the overhead of starting the converter. Default is 'true' |
| API_PORT | Port number to run express application.  Default is 8000. |

#### environment variables example
```
export CACHE_DIR = '/tmp/my-application-holding/files'
export UPLOAD_FIELD_NAME = 'templateFile'
export UPLOAD_FILE_SIZE = '50MB'
export UPLOAD_FILE_COUNT = 1
export START_CARBONE = 'true'

npm start
```


#### review api at /docs
Once mounted, view the Open API spec at /docs. 


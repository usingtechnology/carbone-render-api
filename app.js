const bodyParser = require('body-parser');
const express = require('express');
const mime = require('mime-types');
const path = require('path');
const Problem = require('api-problem');
const telejson = require(`telejson`);

const fileUpload = require('./upload');
const validation = require('./validation');

const FileCache = require('./lib/file-cache');
const carboneRenderer = require('./lib/carbone-render');

const CACHE_DIR = process.env.CACHE_DIR || '/tmp/carbone-files';
const UPLOAD_FIELD_NAME = process.env.UPLOAD_FIELD_NAME || 'template';
const UPLOAD_FILE_SIZE = process.env.UPLOAD_FILE_SIZE || '25MB';
const UPLOAD_FILE_COUNT = process.env.UPLOAD_FILE_COUNT || '1';

const fileCache = new FileCache({fileCachePath: CACHE_DIR});
validation.init({maxFileSize: UPLOAD_FILE_SIZE});
fileUpload.init({
    fileUploadsDir: CACHE_DIR,
    maxFileCount: UPLOAD_FILE_COUNT,
    maxFileSize: UPLOAD_FILE_SIZE,
    formFieldName: UPLOAD_FIELD_NAME
});

const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: true}));

const truthy = (name, options = {}) => {
    const value = options[name] || false;
    return (value === "true" || value === "1" || value === "yes" || value === "y" || value === "t" || value === 1 || value === true);
};

const renderTemplate = async (template, req, res) => {
    let data = req.body.data;
    let options = {};
    let formatters = {};

    try {
        options = req.body.options;
    } catch (e) {
        return new Problem(400, {detail: 'options not provided or formatted incorrectly'}).send(res);
    }

    options.convertTo = options.convertTo || template.ext;
    if (options.convertTo.startsWith('.')) {
        options.convertTo = options.convertTo.slice(1);
    }

    options.reportName = options.reportName || `${path.parse(template.name).name}.${options.convertTo}`;
    // ensure the reportName has the same extension as the convertTo...
    if (options.convertTo !== path.extname(options.reportName).slice(1)) {
        options.reportName = `${path.parse(options.reportName).name}.${options.convertTo}`;
    }

    if (typeof data !== 'object' || data === null) {
        try {
            data = req.body.data;
        } catch (e) {
            return new Problem(400, {detail: 'data not provided or formatted incorrectly'}).send(res);
        }
    }

    try {
        formatters = telejson.parse(req.body.formatters);
    } catch (e) {
    }

    const output = await carboneRenderer.render(template.path, data, options, formatters);

    res.setHeader('Content-Disposition', `attachment; filename=${output.reportName}`);
    res.setHeader('Content-Transfer-Encoding', 'binary');
    res.setHeader('Content-Type', mime.contentType(path.extname(output.reportName)));
    res.setHeader('Content-Length', output.report.length);
    res.setHeader('X-Report-Name', output.reportName);
    res.setHeader('X-Template-Hash', template.hash);

    if (truthy('cacheReport', options)) {
        const rendered = await fileCache.write(output.report, output.reportName, 'binary');
        if (rendered.success) {
            res.setHeader('X-Report-Hash', rendered.hash);
        }
    }

    return res.send(output.report);
};

const getFromCache = async (hash, hashHeaderName, download, res) => {
    const file = fileCache.find(hash);
    if (!file.success) {
        return new Problem(file.errorType, {detail: file.errorMsg}).send(res);
    }
    res.setHeader(hashHeaderName, file.hash);
    if (download) {
        try {
            const cached = await fileCache.read(hash);
            res.setHeader('Content-Disposition', `attachment; filename=${file.name}`);
            res.setHeader('Content-Transfer-Encoding', 'binary');
            res.setHeader('Content-Type', mime.contentType(path.extname(file.name)));
            res.setHeader('Content-Length', cached.length);
            return res.send(cached);
        } catch (e) {
            return new Problem(500, {detail: e.message}).send(res);
        }
    }
    return res.sendStatus(200);
};

const deleteFromCache = async (hash, res) => {
    const file = await fileCache.remove(hash);
    if (!file.success) {
        return new Problem(file.errorType, {detail: file.errorMsg}).send(res);
    }
    return res.sendStatus(200);
};

const findAndRender = async (hash, req, res) => {
    const template = fileCache.find(hash);
    if (!template.success) {
        return new Problem(template.errorType, {detail: template.errorMsg}).send(res);
    } else {
        return await renderTemplate(template, req, res);
    }
};

app.post('/template', fileUpload.upload, async (req, res) => {
    console.log('Template upload');
    console.log(req.file);

    const result = await fileCache.move(req.file.path, req.file.originalname);
    if (!result.success) {
        return new Problem(result.errorType, {detail: result.errorMsg}).send(res);
    } else {
        res.setHeader('X-Template-Hash', result.hash);
        return res.send(result.hash);
    }
});

app.post('/template/render', validation.validateTemplate, async (req, res) => {
    console.log('Template upload and render');
    //console.log(req.body);

    let template = {};
    try {
        template = {...req.body.template};
        if (!template || !template.content) throw Error('Template content not provided.');
        if (!template.fileType) throw Error('Template file type not provided.');
        if (!template.encodingType) throw Error('Template encoding type not provided.');
    } catch (e) {
        return new Problem(400, {detail: e.message}).send(res);
    }

    // let the caller determine if they want to overwrite the template
    //
    const options = req.body.options || {};
    // write to disk...
    const content = await fileCache.write(template.content, template.fileType, template.encodingType, {overwrite: truthy('overwrite', options)});
    if (!content.success) {
        return new Problem(content.errorType, {detail: content.errorMsg}).send(res);
    }

    return await findAndRender(content.hash, req, res);
});

app.post('/template/:uid/render', validation.validateCarbone, async (req, res) => {
    const hash = req.params.uid;
    console.log(`Template render ${hash}.`);
    return await findAndRender(hash, req, res);
});

app.get('/template/:uid', async (req, res) => {
    const hash = req.params.uid;
    const download = req.query.download !== undefined;
    const hashHeaderName = 'X-Template-Hash';
    console.log(`Get Template ${hash}. Download = ${download}`);
    return await getFromCache(hash, hashHeaderName, download, res);
});

app.delete('/template/:uid', async (req, res) => {
    console.log(`Delete template: ${uid}`);
    return await deleteFromCache(req, res);
});

app.get('/render/:uid', async (req, res) => {
    const hash = req.params.uid;
    const download = req.query.download !== undefined;
    const hashHeaderName = 'X-Report-Hash';
    console.log(`Get Rendered report ${hash}. Download = ${download}`);
    return await getFromCache(hash, hashHeaderName, download, res);
});

app.delete('/render/:uid', async (req, res) => {
    console.log(`Delete rendered report: ${uid}`);
    return await deleteFromCache(req, res);
});

app.get('/fileTypes', async (req, res) => {
    console.log('Get fileTypes');
    if (carboneRenderer.fileTypes instanceof Object) {
        res.status(200).json({
            dictionary: carboneRenderer.fileTypes
        });
    } else {
        return new Problem(500, {detail: 'Unable to get file types dictionary'}).send(res);
    }
});

/** OpenAPI Docs */
app.get('/docs', (_req, res) => {
    const docs = require('./docs/docs');
    res.send(docs.getDocHTML('v1'));
});

/** OpenAPI YAML Spec */
app.get('/api-spec.yaml', (_req, res) => {
    res.sendFile(path.join(__dirname, './docs/v1.api-spec.yaml'));
});


// load up carbone on startup, will make the first call to render much quicker
carboneRenderer.startFactory();

// Handle 500
app.use((err, _req, res, _next) => {
    if (err.stack) {
        console.log(err.stack);
    }

    if (err instanceof Problem) {
        err.send(res);
    } else {
        new Problem(500, {details: (err.message) ? err.message : err}).send(res);
    }
});

// Handle 404
app.use((_req, res) => {
    new Problem(404).send(res);
});

// Prevent unhandled errors from crashing application
process.on('unhandledRejection', err => {
    if (err && err.stack) {
        console.log(err.stack);
    }
});

// Graceful shutdown support
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

function shutdown() {
    console.log('Received kill signal. Shutting down...');
    // Wait 3 seconds before hard exiting
    setTimeout(() => process.exit(), 3000);
}

module.exports = app;


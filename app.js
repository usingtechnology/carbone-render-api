const path = require('path');
const telejson = require(`telejson`);
const express = require('express');
const bodyParser = require('body-parser');
const mime = require('mime-types');

const FileCache = require('./lib/file-cache');
const carboneRenderer = require('./lib/carbone-render');

const CACHE_DIR = process.env.CACHE_DIR || '/tmp/carbone-files';

const upload = require(`multer`)({dest: CACHE_DIR});
const fileCache = new FileCache({fileCachePath: CACHE_DIR});

const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: true}));

const renderTemplate = async (template, req, res) => {
    let data = req.body.data;
    let options = {};
    let formatters = {};

    try {
        options = req.body.options;
    } catch (e) {
        return res.status(400).send('options not provided or formatted incorrectly');
    }

    options.convertTo = options.convertTo || template.ext;
    options.reportName = options.reportName || `${path.parse(template.name).name}.${options.convertTo}`;

    if (typeof data !== 'object' || data === null) {
        try {
            data = req.body.data;
        } catch (e) {
            return res.status(400).send('data not provided or formatted incorrectly');
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

    const rendered = await fileCache.write(output.report, output.reportName, 'binary');
    if (rendered.success) {
        res.setHeader('X-Report-Hash', rendered.hash);
    }

    return res.send(output.report);
};

const getFromCache = async(hash, hashHeaderName, download, res) => {
    const file = fileCache.find(hash);
    if (!file.success) {
        return res.status(file.errorType).send(file.errorMsg);
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
            return res.status(500).send(e.message);
        }
    }
    return res.sendStatus(200);
};

const deleteFromCache = async(hash, res) => {
    const file = await fileCache.remove(hash);
    if (!file.success) {
        return res.status(file.errorType).send(file.errorMsg);
    }
    return res.sendStatus(200);
};

const findAndRender = async(hash, req, res) => {
    const template = fileCache.find(hash);
    if (!template.success) {
        return res.status(template.errorType).send(template.errorMsg);
    } else {
        return await renderTemplate(template, req, res);
    }
};

app.post('/template', upload.single('template'), async (req, res) => {
    console.log('Template upload');
    console.log(req.file);

    const result = await fileCache.move(req.file.path, req.file.originalname);
    if (!result.success) {
        return res.status(result.errorType).send(result.errorMsg);
    } else {
        res.setHeader('X-Template-Hash', result.hash);
        return res.send(result.hash);
    }
});

app.post('/template/render', async (req, res) => {
    console.log('Template upload and render');
    //console.log(req.body);

    let template = {};
    try {
        template = {...req.body.template};
        if (!template || !template.content) throw Error('Template content not provided.');
        if (!template.fileType) throw Error('Template file type not provided.');
        if (!template.encodingType) throw Error('Template encoding type not provided.');
    } catch (e) {
        return res.status(400).send(e.message);
    }

    // let the caller determine if they want to overwrite the template
    //
    const options = req.body.options || {};
    const overwrite = options.overwrite ? (options.overwrite === "true" || options.overwrite === true || options.overwrite === 1) : false;
    // write to disk...
    const content = await fileCache.write(template.content, template.fileType, template.encodingType, {overwrite: overwrite});
    if (!content.success) {
        return res.status(content.errorType).send(content.errorMsg);
    }

    return await findAndRender(content.hash, req, res);
});

app.post('/template/:uid/render', async (req, res) => {
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

carboneRenderer.startFactory();

// Handle 404
app.use((_req, res) => {
    res.send(404);
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


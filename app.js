const path = require('path');
const telejson = require(`telejson`);
const express = require('express');
const bodyParser = require('body-parser');
const mime = require('mime-types');

const FileCache = require('./lib/file-cache');
const carboneRenderer = require('./lib/carbone-render');

const cacheDir = process.env.CACHE_DIR || '/tmp/carbone-files';

const upload = require(`multer`)({dest: cacheDir});
const fileCache = new FileCache({fileCachePath: cacheDir});

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

    return res.send(output.report);
};

app.post('/template', upload.single('template'), async (req, res) => {
    console.log('template upload');
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
    console.log('TEMPLATE UPLOAD/RENDER');
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

    // write to disk...
    const content = await fileCache.write(template.content, template.fileType, template.encodingType);
    if (!content.success) {
        return res.status(content.errorType).send(content.errorMsg);
    }

    const cacheTemplate = fileCache.find(content.hash);
    if (!cacheTemplate.success) {
        return res.status(cacheTemplate.errorType).send(cacheTemplate.errorMsg);
    }
    return await renderTemplate(cacheTemplate, req, res);
});

app.post('/template/:uid/render', async (req, res) => {
    console.log('TEMPLATE RENDER');
    console.log(req.body);

    const template = fileCache.find(req.params.uid);
    if (!template.success) {
        return res.status(template.errorType).send(template.errorMsg);
    } else {
        return await renderTemplate(template, req, res);
    }
});

app.get('/template/:uid', async (req, res) => {
    console.log('template check');
    const template = fileCache.find(req.params.uid);
    if (!template.success) {
        return res.status(template.errorType).send(template.errorMsg);
    }
    res.setHeader('X-Template-Hash', template.hash);
    return res.sendStatus(200);
});

app.delete('/template/:uid', async (req, res) => {
    console.log('template check');
    const template = await fileCache.remove(req.params.uid);
    if (!template.success) {
        return res.status(template.errorType).send(template.errorMsg);
    }
    return res.sendStatus(200);
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


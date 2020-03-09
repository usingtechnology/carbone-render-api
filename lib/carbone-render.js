const arrayFilter = require('lodash._arrayfilter');
const carbone = require('carbone');
const fs = require('fs-extra');
const path = require('path');

const asyncRender = async (template, data, options) => {
    return new Promise(((resolve, reject) => {
        carbone.render(template, data, options, (err, result, reportName) => {
            if (err) {
                reject(`Error during Carbone generation. Error: ${err}`);
            } else {
                resolve({report: result, reportName: reportName});
            }
        });
    }));
};

module.exports.startFactory = () => {
    carbone.set({startFactory: true})
};

module.exports.render = async (template, data = {}, options = {}, formatters = {}) => {
    const result = {success: false, errorType: null, errorMsg: null, reportName: null, report: null};

    if (!template) {
        result.errorType = 400;
        result.errorMsg = 'Template not specified.'
        return result;
    }
    if (!fs.existsSync(template)) {
        result.errorType = 404;
        result.errorMsg = 'Template not found.';
        return result;
    }

    // some defaults if options not set...
    if (!options.convertTo || !options.convertTo.trim().length) {
        options.convertTo = path.extname(template).slice(1);
    }
    if (!options.reportName || !options.reportName.trim().length) {
        options.reportName = `${path.parse(template).name}.${options.convertTo}`;
    }

    carbone.formatters = arrayFilter(carbone.formatters, (formatter) => formatter.$isDefault === true);
    carbone.addFormatters(formatters);

    try {
        const renderResult = await asyncRender(template, data, options);
        result.report = renderResult.report;
        result.reportName = renderResult.reportName;
        result.success = true;
    } catch (e) {
        result.errorType = 500;
        result.errorMsg = `Could not render template. ${e.message}`;
        return result;
    }
    return result;
};

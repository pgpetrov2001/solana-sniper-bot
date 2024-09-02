const ModuleScopePlugin = require('react-dev-utils/ModuleScopePlugin');
// const path = require('path');
// const fs = require('fs');

module.exports = function override(config, env) {
    config.resolve.plugins = config.resolve.plugins.filter(plugin => !(plugin instanceof ModuleScopePlugin));
	//Below are core node.js modules that are not available in browser environment:
	//they may be included by some 3rd party packages from the parent project
	config.resolve.fallback = {
		crypto: false,
		os: false,
		path: false,
		stream: false,
	};
	config.resolve.mainFiles = ['index', 'main'];
	config.module.rules.push({
		test: /\.(tsx|ts)$/,
		exclude: /(.*[\\/])?node_modules([\\/].*)?/,
		use: 'ts-loader'
	});
	// const appDirectory = fs.realpathSync(process.cwd());
	// config.resolve.modules.push(path.resolve(appDirectory, '../node_modules'));
    return config;
};

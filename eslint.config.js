import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import prettierPlugin from "eslint-plugin-prettier";
import prettierConfig from "eslint-config-prettier";

export default [
	{
		files: ["**/*.ts", "**/*.tsx"], // Match TypeScript files
		ignores: ["node_modules", "dist", "build"], // Ignore typical output directories

		languageOptions: {
			parser: tsParser,
			ecmaVersion: "latest", // Use the latest ECMAScript features
			sourceType: "module", // Enable ES module syntax
			globals: {
				// Node.js globals
				__dirname: "readonly",
				__filename: "readonly",
				exports: "readonly",
				module: "readonly",
				require: "readonly",
				process: "readonly", // Add `process` for Node.js
			},
		},

        plugins: {
            "@typescript-eslint": tsPlugin,
            prettier: prettierPlugin, // Add Prettier plugin
        },

		rules: {
            ...prettierConfig.rules, // Disable conflicting rules for Prettier
            "prettier/prettier": ["error", { singleQuote: true, semi: true }], // Report Prettier issues as ESLint errors
			"@typescript-eslint/no-unused-vars": [
				"warn",
				{ args: "after-used", argsIgnorePattern: "^_" },
			],
			"@typescript-eslint/no-explicit-any": "warn", // Discourage `any` type
			// "@typescript-eslint/explicit-function-return-type": [
			// 	"warn",
			// 	{ allowExpressions: true },
			// ],
			"@typescript-eslint/no-inferrable-types": "warn", // Warn on unnecessary type annotations

            "eqeqeq": ["error", "always", { "null": "ignore" }], // Enforce strict equality
			"no-empty-function": "warn",
			"consistent-return": "error",

			// Style and Formatting, not needed because handled by Prettier
			// "semi": ["error", "always"],
			// "quotes": ["error", "single"],
			// "indent": ["error", 4],
			// "comma-dangle": ["error", "always-multiline"],

			// Node.js and CommonJS
			"no-process-env": "warn", // Discourage direct `process.env` use
			"no-console": "off", // Allow `console` statements in backend
		},

		linterOptions: {
			reportUnusedDisableDirectives: true, // Report unused ESLint disable comments
		},
	},
];

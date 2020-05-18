/**
 * SPDX-FileCopyrightText: © 2020 Liferay, Inc. <https://liferay.com>
 * SPDX-License-Identifier: LGPL-3.0-or-later
 */

import fs from 'fs-extra';
import {
	JsSourceTransform,
	PkgJson,
	setPortletHeader,
	transformJsSourceFile,
	transformJsonFile,
	transformTextFile,
	wrapModule,
} from 'liferay-js-toolkit-core';
import path from 'path';

import {buildBundlerDir, buildGeneratedDir, project} from '../../globals';
import * as log from '../../log';
import {copyFiles, findFiles} from '../../util/files';
import Renderer from '../../util/renderer';
import exportModuleAsFunction from './transform/js/operation/exportModuleAsFunction';
import namespaceWepbackJsonp from './transform/js/operation/namespaceWepbackJsonp';
import replace from './transform/text/operation/replace';

export async function copyStaticAssets(globs: string[]): Promise<void> {
	const copiedFiles = copyFiles(
		project.dir.join(project.adapt.buildDir),
		globs,
		buildBundlerDir
	);

	log.debug(`Copied ${copiedFiles.length} static assets`);
}

/**
 * Generate adapter modules based on templates.
 *
 * @param data extra values to pass to render engine in addition to `project`
 */
export async function processAdapterModules(data: object = {}): Promise<void> {
	const renderer = new Renderer(
		path.join(__dirname, project.probe.type, 'templates')
	);

	await processAdapterModule(renderer, 'adapt-rt.js', {
		project,
		...data,
	});
	await processAdapterModule(renderer, 'index.js', {
		project,
		...data,
	});
}

/**
 * Process all webpack bundles to make them deployable.
 *
 * @param frameworkSpecificTransforms
 * underlying framework specific transforms to apply
 */
export async function processWebpackBundles(
	globs: string[],
	...frameworkSpecificTransforms: JsSourceTransform[]
): Promise<void> {
	const adaptBuildDir = project.dir.join(project.adapt.buildDir);

	const copiedBundles = findFiles(adaptBuildDir, globs);

	const {name, version} = project.pkgJson;

	await Promise.all(
		copiedBundles.map(async (file) => {
			const moduleName = file.asPosix.replace(/\.js$/g, '');

			await transformJsSourceFile(
				adaptBuildDir.join(file),
				buildBundlerDir.join(file),
				...frameworkSpecificTransforms,
				namespaceWepbackJsonp(),
				exportModuleAsFunction(),
				wrapModule(`${name}@${version}/${moduleName}`)
			);
		})
	);

	log.debug(`Wrapped ${copiedBundles.length} webpack bundles`);
}

async function processAdapterModule(
	renderer: Renderer,
	templatePath: string,
	data: object
): Promise<void> {
	const fromFile = buildGeneratedDir.join(templatePath);
	const toFile = buildBundlerDir.join(templatePath);

	fs.writeFileSync(
		fromFile.asNative,
		await renderer.render(templatePath, data)
	);

	const {name, version} = project.pkgJson;

	const moduleName = templatePath.replace(/\.js$/i, '');

	await transformJsSourceFile(
		fromFile,
		toFile,
		wrapModule(`${name}@${version}/${moduleName}`)
	);

	log.debug(`Rendered ${templatePath} adapter module`);
}

/**
 * Process CSS files to rewrite URLs to static assets so that they can be served
 * from Liferay.
 *
 * @param cssGlobs globs of CSS files to process
 * @param assetGlobs globs of static assets to rewrite in CSS files
 *
 * @remarks
 * This is a best effort approach that may not work when proxies or CDNs are
 * configured because we are hardcoding the '/o' part of the URL and not using
 * the adapt runtime to rewrite the URLs.
 *
 * Of course that is because we cannot execute anything inside CSS files, so we
 * can only rewrite them at build time.
 */
export async function processCssFiles(
	cssGlobs: string[],
	assetGlobs: string[]
): Promise<void> {
	const adaptBuildDir = project.dir.join(project.adapt.buildDir);

	const cssFiles = findFiles(adaptBuildDir, cssGlobs);

	const assetURLsMap = findFiles(adaptBuildDir, assetGlobs).reduce(
		(map, sourceAsset) => {
			map.set(
				sourceAsset.asPosix,
				`o${project.jar.webContextPath}/${sourceAsset.asPosix}`
			);

			return map;
		},
		new Map<string, string>()
	);

	await Promise.all(
		cssFiles.map(async (file) => {
			await transformTextFile(
				adaptBuildDir.join(file),
				buildBundlerDir.join(file),
				replace(assetURLsMap)
			);
		})
	);

	log.debug(`Processed ${cssFiles.length} CSS files`);
}

export async function processPackageJson(
	cssPortletHeader: string | undefined
): Promise<void> {
	const fromFile = project.dir.join('package.json');
	const toFile = buildBundlerDir.join('package.json');

	await transformJsonFile<PkgJson>(
		fromFile,
		toFile,
		setPortletHeader(
			'com.liferay.portlet.header-portlet-css',
			cssPortletHeader
		)
	);
}

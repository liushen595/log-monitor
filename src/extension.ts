import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as PathUtils from './pathUtils';
import { StateManager } from './stateManager';

// 输出通道
let logOutputChannel: vscode.OutputChannel;

// 保存所有活跃的文件监视器
let activeFileWatchers: vscode.FileSystemWatcher[] = [];

/**
 * 从日志文件读取内容并输出到输出面板
 * @param uri 日志文件URI
 * @param showOnUpdate 是否在更新时显示输出面板，默认为true
 * @param isUpdate 是否为更新操作，默认为false
 */
async function readAndDisplayLog(uri: vscode.Uri, showOnUpdate: boolean = true, isUpdate: boolean = false): Promise<void> {
    try {
        // 记录详细的URI信息，用于调试
        console.log(`准备读取文件: ${uri.toString()}`);
        console.log(`文件 scheme: ${uri.scheme}`);
        console.log(`文件 authority: ${uri.authority || '无'}`);
        console.log(`文件 path: ${uri.path}`);
        console.log(`文件 fsPath: ${uri.fsPath}`);

        // 检查URI是否有效
        if (!uri || !uri.scheme) {
            throw new Error(`无效的URI: ${uri}`);
        }

        // 从状态管理器获取环境信息
        const stateManager = StateManager.getInstance();
        const envInfo = stateManager.getEnvironmentInfo();
        console.log('环境信息:', JSON.stringify(envInfo, null, 2));

        // 直接使用VS Code API读取文件，不进行路径转换
        let fileContent: Uint8Array;

        try {
            // 直接读取，保留原始URI信息
            fileContent = await vscode.workspace.fs.readFile(uri);
            console.log('成功直接读取文件');
        } catch (readError) {
            console.error('直接读取文件失败:', readError);
            throw readError;
        }

        // 将内容转换为字符串
        const content = Buffer.from(fileContent).toString('utf8');

        // 如果是更新操作，只添加更新信息和新内容，否则清除并重新显示全部内容
        if (isUpdate) {
            const timestamp = new Date().toLocaleString();
            logOutputChannel.appendLine(`\n[${timestamp}] === 日志文件已更新 ===`);
            logOutputChannel.append(content);
        } else {
            // 清除之前的输出内容
            logOutputChannel.clear();

            // 在输出面板中显示当前监控的文件路径和环境信息
            logOutputChannel.appendLine(`\n[系统] 当前监控文件: ${uri.toString()}`);
            logOutputChannel.appendLine(`[系统] 本地系统: ${envInfo.localOSType}, 远程系统: ${envInfo.remoteOSType}`);
            logOutputChannel.appendLine(`[系统] 是否远程环境: ${envInfo.isRemote ? '是' : '否'}`);
            if (envInfo.isRemote) {
                logOutputChannel.appendLine(`[系统] 远程类型: ${envInfo.remoteType || '未知'}`);
            }
            logOutputChannel.appendLine(`[系统] 文件读取成功`);
            logOutputChannel.appendLine(`\n=== 日志内容开始 ===\n`);

            // 添加文件内容
            logOutputChannel.append(content);
        }

        // 如果需要显示输出面板，则调用show方法
        if ((isUpdate && showOnUpdate) || !isUpdate) {
            logOutputChannel.show(true); // true表示不获取焦点
        }

    } catch (error) {
        if (error instanceof Error) {
            const errorMsg = `读取日志文件失败: ${error.message}`;
            vscode.window.showErrorMessage(errorMsg);
            logOutputChannel.appendLine(`[错误] 无法读取文件: ${uri.toString()}`);
            logOutputChannel.appendLine(`[错误详情] ${error.message}`);

            // 添加额外的调试信息
            console.error('读取文件失败的完整错误:', error);
            if (error.stack) {
                console.error('错误堆栈:', error.stack);
            }
        } else {
            vscode.window.showErrorMessage(`读取日志文件发生未知错误`);
        }
    }
}

/**
 * 设置日志文件路径
 * 允许用户选择一个日志文件进行监控
 */
async function selectLogFile(): Promise<vscode.Uri | undefined> {
    // 从状态管理器获取环境信息
    const stateManager = StateManager.getInstance();
    const envInfo = stateManager.getEnvironmentInfo();

    console.log(`当前环境信息:`, JSON.stringify(envInfo, null, 2));

    const options: vscode.OpenDialogOptions = {
        canSelectMany: false,
        openLabel: '选择日志文件',
        filters: {
            'Log files': ['log'],
            'All files': ['*']
        }
    };

    try {
        const fileUri = await vscode.window.showOpenDialog(options);
        if (fileUri && fileUri.length > 0) {
            // 获取选中文件的URI
            const selectedUri = fileUri[0];

            // 输出详细调试信息
            console.log(`选择的文件 URI: ${selectedUri.toString()}`);
            console.log(`选择的文件 scheme: ${selectedUri.scheme}`);
            console.log(`选择的文件 authority: ${selectedUri.authority}`);
            console.log(`选择的文件 path: ${selectedUri.path}`);
            console.log(`选择的文件 fsPath: ${selectedUri.fsPath}`);

            // 直接返回原始URI，保留完整的远程信息
            return selectedUri;
        }
        return undefined;
    } catch (error) {
        console.error('选择文件过程中发生错误:', error);
        vscode.window.showErrorMessage(`选择文件时出错: ${error instanceof Error ? error.message : '未知错误'}`);
        return undefined;
    }
}

/**
 * 开始监控指定的日志文件
 * @param context 扩展上下文
 * @param fileUri 日志文件URI或路径
 */
async function startWatchingLogFile(context: vscode.ExtensionContext, fileUri: vscode.Uri | string): Promise<void> {
    // 从状态管理器获取环境信息
    const stateManager = StateManager.getInstance();
    const envInfo = stateManager.getEnvironmentInfo();
    console.log('开始监控文件 - 环境信息:', JSON.stringify(envInfo, null, 2));

    // 确保有一个有效的URI
    let uri: vscode.Uri;

    if (typeof fileUri === 'string') {
        // 将字符串路径转换为规范化的 VS Code URI，基于目标系统类型
        const targetOS = envInfo.isRemote ? envInfo.remoteOSType : envInfo.localOSType;
        uri = PathUtils.normalizeFileUri(fileUri, targetOS);
        console.log(`从字符串路径创建URI: ${uri.toString()}`);
    } else {
        // 已经是URI，直接使用
        uri = fileUri;
        console.log(`使用提供的URI: ${uri.toString()}`);
    }

    // 输出监控文件路径信息，用于调试
    console.log(`监控文件URI: ${uri.toString()}`);
    console.log(`监控文件 scheme: ${uri.scheme}`);
    console.log(`监控文件 path: ${uri.path}`);
    console.log(`监控文件 fsPath: ${uri.fsPath}`);

    // 显示文件URI的详细信息
    showFileURIDetails(uri);

    // 使用平台感知的方法创建文件监视器
    const fileSystemWatcher = vscode.workspace.createFileSystemWatcher(uri.toString(), false, false, false);

    if (!fileSystemWatcher) {
        const errorMsg = '创建文件监视器失败，无法监控文件';
        console.error(errorMsg);
        vscode.window.showErrorMessage(errorMsg);
        return;
    }

    console.log('成功创建文件监视器');

    // 监听文件变化事件
    fileSystemWatcher.onDidChange(async (changedUri) => {
        console.log(`文件变化事件: ${changedUri.toString()}`);
        // 使用isUpdate=true参数，表明这是文件更新事件
        await readAndDisplayLog(changedUri, true, true);
    });

    // 监听文件创建事件（例如文件被删除后重新创建）
    fileSystemWatcher.onDidCreate(async (createdUri) => {
        console.log(`文件创建事件: ${createdUri.toString()}`);
        // 文件被重新创建，不是更新事件
        await readAndDisplayLog(createdUri, true, false);
    });

    // 监听文件删除事件
    fileSystemWatcher.onDidDelete((deletedUri) => {
        console.log(`文件删除事件: ${deletedUri.toString()}`);
        logOutputChannel.appendLine(`[${new Date().toLocaleTimeString()}] 日志文件已删除`);
    });

    // 首次读取文件内容
    try {
        console.log('尝试首次读取文件内容');
        await readAndDisplayLog(uri);
        console.log('首次读取文件成功');
    } catch (readError) {
        console.error('首次读取文件失败:', readError);
        vscode.window.showErrorMessage(`无法读取日志文件: ${readError instanceof Error ? readError.message : '未知错误'}`);
    }

    // 将文件监视器添加到上下文和活跃监视器列表中
    context.subscriptions.push(fileSystemWatcher);
    activeFileWatchers.push(fileSystemWatcher);

    // 显示成功消息
    const fileName = uri.path.split('/').pop() || uri.fsPath.split(/[\/\\]/).pop() || '未知文件';
    vscode.window.showInformationMessage(`开始监控日志文件: ${fileName}`);
}

/**
 * 显示文件URI详细信息（用于调试）
 * @param uri 文件URI
 */
function showFileURIDetails(uri: vscode.Uri): void {
    const uriDetails = {
        toString: uri.toString(),
        scheme: uri.scheme,
        authority: uri.authority,
        path: uri.path,
        query: uri.query,
        fragment: uri.fragment,
        fsPath: uri.fsPath
    };

    // 在输出面板显示
    if (logOutputChannel) {
        logOutputChannel.appendLine('\n[系统] 文件URI详细信息:');
        Object.entries(uriDetails).forEach(([key, value]) => {
            logOutputChannel.appendLine(`[系统] ${key}: ${value}`);
        });
        logOutputChannel.show();
    }

    console.log('文件URI详细信息:', JSON.stringify(uriDetails, null, 2));
}

/**
 * 显示当前环境信息（用于调试）
 */
function showEnvironmentInfo() {
    const stateManager = StateManager.getInstance();
    const envInfo = stateManager.getEnvironmentInfo();

    // 创建消息内容
    const message =
        `当前环境信息:\n` +
        `- 本地系统: ${envInfo.localOSType}\n` +
        `- 远程系统: ${envInfo.remoteOSType}\n` +
        `- 远程类型: ${envInfo.remoteType || '无'}\n` +
        `- 是否远程: ${envInfo.isRemote ? '是' : '否'}`;

    // 在输出面板显示
    if (logOutputChannel) {
        logOutputChannel.appendLine('\n[系统] 环境信息检测:');
        logOutputChannel.appendLine(`[系统] 本地系统: ${envInfo.localOSType}`);
        logOutputChannel.appendLine(`[系统] 远程系统: ${envInfo.remoteOSType}`);
        logOutputChannel.appendLine(`[系统] 远程类型: ${envInfo.remoteType || '无'}`);
        logOutputChannel.appendLine(`[系统] 是否远程: ${envInfo.isRemote ? '是' : '否'}`);
        logOutputChannel.show();
    }

    // 显示通知
    vscode.window.showInformationMessage(message, '确定').then(() => {
        // 如果需要，可以在用户点击确定后执行其他操作
    });

    console.log('环境信息:', JSON.stringify(envInfo, null, 2));

    return envInfo;
}

// 使用 PathUtils 模块中的 normalizeFileUri 函数

export function activate(context: vscode.ExtensionContext) {
    console.log('日志监控插件已激活');

    // 创建输出通道
    logOutputChannel = vscode.window.createOutputChannel('日志监控器');

    // 初始化环境信息并存入状态管理器
    console.log('初始化环境信息...');
    const envInfo = PathUtils.getEnvironmentInfo();
    StateManager.getInstance().initialize(envInfo);
    console.log('环境信息初始化完成');

    // 注册命令：开始监控日志文件
    let startWatchingCommand = vscode.commands.registerCommand('log-monitor.startWatching', async () => {
        const logFilePath = await selectLogFile();
        if (logFilePath) {
            await startWatchingLogFile(context, logFilePath);
            // 显示输出面板
            logOutputChannel.show();
        }
    });

    // 注册命令：显示环境信息（用于调试）
    let showEnvCommand = vscode.commands.registerCommand('log-monitor.showEnvironment', () => {
        showEnvironmentInfo();
    });

    // 注册命令：显示当前监控的文件URI信息（用于调试）
    let showURICommand = vscode.commands.registerCommand('log-monitor.showURIDetails', async () => {
        // 如果没有活动监视器，提示用户先选择文件
        if (activeFileWatchers.length === 0) {
            const result = await vscode.window.showInformationMessage('当前没有监控任何文件。是否选择一个文件？', '是', '否');
            if (result === '是') {
                const fileUri = await selectLogFile();
                if (fileUri) {
                    showFileURIDetails(fileUri);
                    logOutputChannel.show();
                }
            }
        } else {
            // 显示所有当前监控的文件URI信息
            logOutputChannel.appendLine('\n[系统] 当前正在监控的文件数量: ' + activeFileWatchers.length);
            logOutputChannel.appendLine('[系统] 由于技术限制，无法直接显示文件监视器的路径。');
            logOutputChannel.appendLine('[系统] 请在停止监控后重新选择文件以查看详细信息。');
            logOutputChannel.show();
        }
    });

    // 注册命令：停止监控日志文件
    let stopWatchingCommand = vscode.commands.registerCommand('log-monitor.stopWatching', () => {
        // 清除所有活跃的文件监视器
        if (activeFileWatchers.length > 0) {
            // 依次销毁每个监视器
            activeFileWatchers.forEach(watcher => {
                watcher.dispose();
            });

            // 清空监视器列表
            activeFileWatchers = [];

            vscode.window.showInformationMessage('已停止监控所有日志文件');
            logOutputChannel.appendLine('[系统] 已停止监控所有日志文件');
        } else {
            vscode.window.showInformationMessage('当前没有日志文件被监控');
            logOutputChannel.appendLine('[系统] 当前没有日志文件被监控');
        }
    });

    // 将命令注册到上下文中
    context.subscriptions.push(startWatchingCommand);
    context.subscriptions.push(stopWatchingCommand);
    context.subscriptions.push(showEnvCommand);
    context.subscriptions.push(showURICommand);
    context.subscriptions.push(logOutputChannel);
}

export function deactivate() {
    // 释放资源
    if (logOutputChannel) {
        logOutputChannel.dispose();
    }

    // 释放所有活跃的文件监视器
    activeFileWatchers.forEach(watcher => {
        try {
            watcher.dispose();
        } catch (error) {
            console.error('释放文件监视器失败:', error);
        }
    });

    // 清空列表
    activeFileWatchers = [];
}

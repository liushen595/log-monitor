import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { StateManager } from './stateManager';

/**
 * 操作系统类型枚举
 */
export enum OSType {
    Windows = 'windows',
    Linux = 'linux',
    MacOS = 'macos',
    Unknown = 'unknown'
}

/**
 * 环境信息
 */
export interface EnvironmentInfo {
    /** 是否为远程环境 */
    isRemote: boolean;
    /** 远程环境类型 (如 'ssh', 'wsl', 'containers', 等) */
    remoteType: string | undefined;
    /** 本地系统类型 */
    localOSType: OSType;
    /** 远程系统类型 (如果可检测) */
    remoteOSType: OSType;
}

/**
 * 获取当前环境信息
 * @returns 环境信息对象
 */
export function getEnvironmentInfo(): EnvironmentInfo {
    // 打印环境检测开始信息
    console.log('开始检测环境信息...');

    // 检测是否为远程环境
    const isRemote = process.env.REMOTE_CONTAINERS === 'true' ||
        vscode.env.remoteName !== undefined;

    console.log(`是否为远程环境: ${isRemote}`);

    // 获取远程类型
    const remoteType = vscode.env.remoteName;
    console.log(`远程类型: ${remoteType || '无'}`);

    // 打印VS Code相关环境信息
    console.log(`VS Code 版本: ${vscode.version}`);
    console.log(`应用名称: ${vscode.env.appName || '未知'}`);
    console.log(`应用主机: ${vscode.env.appHost || '未知'}`);

    // 获取并打印可用的环境变量，有助于调试
    console.log('环境变量检查:');
    const envVarChecks = [
        'VSCODE_REMOTE_PLATFORM', 'REMOTE_CONTAINERS',
        'SHELL', 'TERM', 'SSH_CONNECTION',
        'WINDIR', 'SystemRoot', 'USERPROFILE'
    ];

    envVarChecks.forEach(varName => {
        console.log(`  ${varName}: ${process.env[varName] || '未设置'}`);
    });

    // 获取本地系统类型
    const localOSType = getLocalOSType();
    console.log(`本地系统类型: ${localOSType}`);

    // 获取远程系统类型（推断）
    console.log('开始推断远程系统类型...');
    const remoteOSType = inferRemoteOSType(remoteType);
    console.log(`推断的远程系统类型: ${remoteOSType}`);

    // 构建环境信息对象
    const envInfo: EnvironmentInfo = {
        isRemote,
        remoteType,
        localOSType,
        remoteOSType
    };

    console.log('环境信息检测完成:', envInfo);
    return envInfo;
}

/**
 * 获取本地系统类型
 * @returns 操作系统类型
 */
function getLocalOSType(): OSType {
    switch (process.platform) {
        case 'win32':
            return OSType.Windows;
        case 'linux':
            return OSType.Linux;
        case 'darwin':
            return OSType.MacOS;
        default:
            return OSType.Unknown;
    }
}

/**
 * 推断远程系统类型（基于远程类型和环境特征）
 * @param remoteType 远程类型
 * @returns 操作系统类型
 */
function inferRemoteOSType(remoteType: string | undefined): OSType {
    console.log(`开始推断远程系统类型，远程类型: ${remoteType || '无'}`);

    if (!remoteType) {
        console.log('没有远程类型信息，返回未知');
        return OSType.Unknown;
    }

    // 尝试从VSCODE_REMOTE_PLATFORM环境变量获取信息
    if (process.env.VSCODE_REMOTE_PLATFORM) {
        const remotePlatform = process.env.VSCODE_REMOTE_PLATFORM.toLowerCase();
        console.log(`检测到VSCODE_REMOTE_PLATFORM: ${remotePlatform}`);

        if (remotePlatform.includes('linux')) {
            console.log('远程平台是Linux');
            return OSType.Linux;
        } else if (remotePlatform.includes('darwin') || remotePlatform.includes('mac')) {
            console.log('远程平台是macOS');
            return OSType.MacOS;
        } else if (remotePlatform.includes('win')) {
            console.log('远程平台是Windows');
            return OSType.Windows;
        }
    }

    // 基于远程类型推断操作系统类型
    console.log(`基于远程类型"${remoteType}"推断系统类型`);
    switch (remoteType) {
        case 'wsl':
        case 'wsl-remote':
            console.log('WSL环境，确定为Linux');
            return OSType.Linux;

        case 'ssh-remote':
            // SSH可以连接到各种系统，需要进一步推断
            console.log('SSH远程连接，需要进一步推断');

            // 检查远程连接主机名是否包含操作系统信息
            const sshTarget = process.env.SSH_CONNECTION || '';
            console.log(`SSH连接信息: ${sshTarget}`);

            if (sshTarget.includes('linux') || sshTarget.includes('ubuntu') ||
                sshTarget.includes('debian') || sshTarget.includes('centos')) {
                console.log('SSH连接到Linux系统');
                return OSType.Linux;
            }

            // 使用专门的SSH远程检测
            return inferSSHRemoteOSType();

        case 'containers':
        case 'dev-container':
        case 'attached-container':
            // Docker容器通常基于Linux
            console.log('容器环境，默认为Linux');
            return OSType.Linux;

        default:
            console.log(`未知远程类型"${remoteType}"，尝试基于环境特征推断`);

            // 对于未知类型，尝试更多环境检测
            if (process.env.SHELL || process.env.BASH) {
                console.log('检测到Shell环境，可能是Linux/macOS');

                if (process.env.SHELL && process.env.SHELL.includes('darwin')) {
                    return OSType.MacOS;
                }
                return OSType.Linux;
            } else if (process.env.WINDIR || process.env.SystemRoot) {
                console.log('检测到Windows环境变量');
                return OSType.Windows;
            }

            // 无法确定时默认为Linux（最常见的远程环境）
            console.log('无法确定远程类型，默认为Linux');
            return OSType.Linux;
    }
}

/**
 * 推断SSH远程系统类型
 * 通过远程环境特性检测
 * @returns 操作系统类型
 */
function inferSSHRemoteOSType(): OSType {
    // 检查是否存在远程主机信息
    const remoteHostInfo = vscode.env.remoteName || '';
    console.log(`SSH远程环境检测 - 远程名称: ${remoteHostInfo}`);

    // 尝试使用 VS Code API 检测远程主机类型
    try {
        // 使用 os 模块的 EOL（行结束符）来判断，但注意这可能反映的是本地环境
        // 因此这个方法不可靠，只作为备选

        // 更可靠的方法：检查SSH连接提供的环境变量
        if (process.env.SSH_CONNECTION) {
            console.log(`检测到SSH连接: ${process.env.SSH_CONNECTION}`);

            // 检查Linux/Unix特有环境变量
            if (process.env.SHELL || process.env.BASH || process.env.ZSH) {
                console.log(`检测到Linux/Unix shell环境变量`);

                // 进一步区分Linux和macOS
                if (process.env.SHELL && process.env.SHELL.includes('darwin')) {
                    return OSType.MacOS;
                }
                return OSType.Linux;
            }

            // 检查Windows特有环境变量
            if (process.env.WINDIR || process.env.windir || process.env.SystemRoot || process.env.USERPROFILE) {
                console.log(`检测到Windows环境变量`);
                return OSType.Windows;
            }
        }

        // 检查远程主机名格式特征
        if (remoteHostInfo.includes('linux') || remoteHostInfo.includes('ubuntu') ||
            remoteHostInfo.includes('debian') || remoteHostInfo.includes('centos')) {
            return OSType.Linux;
        }

        if (remoteHostInfo.includes('darwin') || remoteHostInfo.includes('mac')) {
            return OSType.MacOS;
        }

        // 如果无法确定，使用主动探测方法
        return detectRemoteOSTypeByFeature();
    } catch (error) {
        console.error('远程系统类型检测失败:', error);
        // 默认假设为Linux（最常见的远程环境）
        return OSType.Linux;
    }
}

/**
 * 通过特征探测远程操作系统类型
 * 使用多种方法尝试确定远程系统类型
 * @returns 操作系统类型
 */
function detectRemoteOSTypeByFeature(): OSType {
    console.log('使用特征探测远程操作系统类型');

    try {
        // 方法1: 检查远程终端输出
        const isRemoteTerminalAvailable = vscode.window.terminals.length > 0;

        if (isRemoteTerminalAvailable) {
            console.log('远程终端可用，可以考虑使用终端命令探测');
        }

        // 方法2: 使用文件系统路径特征
        // 这种方法可能不够准确，因为路径可能被映射

        // 方法3: 查看扩展环境变量
        if (process.env.VSCODE_REMOTE_PLATFORM) {
            const remotePlatform = process.env.VSCODE_REMOTE_PLATFORM.toLowerCase();
            console.log(`检测到远程平台环境变量: ${remotePlatform}`);

            if (remotePlatform.includes('linux')) {
                return OSType.Linux;
            } else if (remotePlatform.includes('darwin') || remotePlatform.includes('mac')) {
                return OSType.MacOS;
            } else if (remotePlatform.includes('win')) {
                return OSType.Windows;
            }
        }

        // 方法4: 检查VS Code远程环境信息
        if (vscode.env.appHost) {
            const appHost = vscode.env.appHost.toLowerCase();
            console.log(`VS Code 应用主机: ${appHost}`);

            if (appHost.includes('linux')) {
                return OSType.Linux;
            } else if (appHost.includes('darwin') || appHost.includes('mac')) {
                return OSType.MacOS;
            } else if (appHost.includes('win')) {
                return OSType.Windows;
            }
        }

    } catch (error) {
        console.error('远程特征探测失败:', error);
    }

    // 无法确定时，最安全的默认值是Linux
    console.log('无法确定远程系统类型，默认使用Linux');
    return OSType.Linux;
}

/**
 * 规范化文件路径，使其在不同操作系统间正确工作
 * @param pathOrUri 文件路径或URI
 * @param targetOS 目标系统类型
 * @returns 规范化后的URI
 */
export function normalizeFileUri(pathOrUri: string | vscode.Uri, targetOS?: OSType): vscode.Uri {
    try {
        // 从状态管理器获取环境信息
        const stateManager = StateManager.getInstance();
        const envInfo = stateManager.isStateInitialized() ?
            stateManager.getEnvironmentInfo() :
            getEnvironmentInfo(); // 如果状态管理器未初始化，则调用函数获取

        // 如果未指定目标系统，根据环境推断
        if (!targetOS) {
            targetOS = envInfo.isRemote ? envInfo.remoteOSType : envInfo.localOSType;
        }

        console.log(`目标系统类型: ${targetOS}`);

        // 如果已经是 Uri，直接返回
        if (pathOrUri instanceof vscode.Uri) {
            return pathOrUri;
        }

        if (typeof pathOrUri !== 'string') {
            return vscode.Uri.file(String(pathOrUri));
        }

        // 记录原始路径，用于调试
        const originalPath = pathOrUri;

        // 检查是否已经是 URI 字符串格式 (例如 "file://...")
        if (pathOrUri.startsWith('file:') ||
            pathOrUri.startsWith('vscode-remote:') ||
            pathOrUri.startsWith('vsls:')) {
            return vscode.Uri.parse(pathOrUri);
        }

        // 根据目标系统类型处理路径格式
        if (envInfo.isRemote && targetOS === OSType.Linux) {
            // Windows路径格式转换为Linux路径格式
            const windowsPathRegex = /^[A-Za-z]:\\(?:\\[^\\]+)+$/;
            if (windowsPathRegex.test(pathOrUri)) {
                console.log('转换Windows路径到Linux格式:', pathOrUri);

                // 将Windows路径转换为Linux路径
                let correctedPath = pathOrUri.substr(2).replace(/\\/g, '/');

                // 如果不是以/开头，添加/
                if (!correctedPath.startsWith('/')) {
                    correctedPath = '/' + correctedPath;
                }

                console.log('转换后的路径:', correctedPath);
                pathOrUri = correctedPath;
            }
        } else if (envInfo.isRemote && targetOS === OSType.Windows) {
            // Linux路径格式转换为Windows路径格式
            if (pathOrUri.startsWith('/') && !pathOrUri.includes(':')) {
                // 这是一个简单的启发式方法，可能需要更复杂的逻辑
                console.log('转换Linux路径到Windows格式:', pathOrUri);

                // 默认使用C盘
                const correctedPath = 'C:' + pathOrUri.replace(/\//g, '\\');
                console.log('转换后的路径:', correctedPath);
                pathOrUri = correctedPath;
            }
        }

        // 打印最终处理的路径
        console.log(`原始路径: ${originalPath}`);
        console.log(`处理后路径: ${pathOrUri}`);

        // 创建URI
        const uri = vscode.Uri.file(pathOrUri);
        console.log(`生成的URI: ${uri.toString()}`);

        return uri;
    } catch (error) {
        console.error('路径规范化失败:', error);

        // 如果转换失败，记录更多信息
        if (typeof pathOrUri === 'string') {
            console.error(`尝试规范化路径: ${pathOrUri}`);
        }

        // 使用安全的方法创建URI
        return vscode.Uri.file(String(pathOrUri));
    }
}

/**
 * 根据目标系统类型创建文件系统监视器
 * @param filePath 文件路径
 * @param targetOS 目标系统类型
 * @returns 文件系统监视器
 */
export function createPlatformAwareFileSystemWatcher(
    filePath: string | vscode.Uri,
    ignoreCreate: boolean = false,
    ignoreChange: boolean = false,
    ignoreDelete: boolean = false
): vscode.FileSystemWatcher | undefined {
    try {
        // 从状态管理器获取环境信息
        const stateManager = StateManager.getInstance();
        const envInfo = stateManager.isStateInitialized() ?
            stateManager.getEnvironmentInfo() :
            getEnvironmentInfo(); // 如果状态管理器未初始化，则调用函数获取
        console.log('创建监视器 - 环境信息:', envInfo);

        // 确定目标系统类型
        const targetOS = envInfo.isRemote ? envInfo.remoteOSType : envInfo.localOSType;

        // 规范化URI
        const fileUri = typeof filePath === 'string' ?
            normalizeFileUri(filePath, targetOS) :
            filePath;

        console.log(`创建监视器 - 文件URI: ${fileUri.toString()}`);

        // 根据目标系统类型选择合适的监视器创建方法
        let watcher: vscode.FileSystemWatcher | undefined;

        if (envInfo.isRemote) {
            if (targetOS === OSType.Linux || targetOS === OSType.MacOS) {
                // 在远程Linux/macOS环境中
                console.log('在远程Unix环境中创建监视器');

                // 尝试方法1: 使用URI的path属性
                try {
                    const uriPath = fileUri.path;
                    console.log(`尝试使用URI路径: ${uriPath}`);
                    watcher = vscode.workspace.createFileSystemWatcher(uriPath, ignoreCreate, ignoreChange, ignoreDelete);
                    console.log('使用URI路径成功创建监视器');
                    return watcher;
                } catch (error1) {
                    console.error('使用URI路径创建监视器失败:', error1);

                    // 尝试方法2: 使用全URI
                    try {
                        console.log(`尝试使用完整URI: ${fileUri.toString()}`);
                        watcher = vscode.workspace.createFileSystemWatcher(fileUri.toString(), ignoreCreate, ignoreChange, ignoreDelete);
                        console.log('使用完整URI成功创建监视器');
                        return watcher;
                    } catch (error2) {
                        console.error('使用完整URI创建监视器失败:', error2);

                        // 尝试方法3: 使用相对模式
                        try {
                            const fileName = path.basename(fileUri.path);
                            const dirPath = path.dirname(fileUri.path);
                            const dirUri = vscode.Uri.file(dirPath);

                            console.log(`尝试使用相对模式: 目录=${dirPath}, 文件=${fileName}`);
                            const pattern = new vscode.RelativePattern(dirUri, fileName);
                            watcher = vscode.workspace.createFileSystemWatcher(pattern, ignoreCreate, ignoreChange, ignoreDelete);
                            console.log('使用相对模式成功创建监视器');
                            return watcher;
                        } catch (error3) {
                            console.error('使用相对模式创建监视器失败:', error3);
                        }
                    }
                }
            } else if (targetOS === OSType.Windows) {
                // 在远程Windows环境中
                console.log('在远程Windows环境中创建监视器');

                // Windows环境中可能需要特殊处理
                try {
                    console.log(`尝试使用fsPath: ${fileUri.fsPath}`);
                    watcher = vscode.workspace.createFileSystemWatcher(fileUri.fsPath, ignoreCreate, ignoreChange, ignoreDelete);
                    console.log('使用fsPath成功创建监视器');
                    return watcher;
                } catch (error) {
                    console.error('使用fsPath创建监视器失败，尝试使用URI:', error);

                    try {
                        watcher = vscode.workspace.createFileSystemWatcher(fileUri.toString(), ignoreCreate, ignoreChange, ignoreDelete);
                        console.log('使用URI成功创建监视器');
                        return watcher;
                    } catch (error2) {
                        console.error('使用URI创建监视器失败:', error2);
                    }
                }
            }
        } else {
            // 本地环境
            console.log('在本地环境中创建监视器');

            try {
                if (typeof filePath === 'string') {
                    watcher = vscode.workspace.createFileSystemWatcher(filePath, ignoreCreate, ignoreChange, ignoreDelete);
                } else {
                    watcher = vscode.workspace.createFileSystemWatcher(fileUri.fsPath, ignoreCreate, ignoreChange, ignoreDelete);
                }
                console.log('在本地环境成功创建监视器');
                return watcher;
            } catch (error) {
                console.error('在本地环境创建监视器失败:', error);

                try {
                    watcher = vscode.workspace.createFileSystemWatcher(fileUri.toString(), ignoreCreate, ignoreChange, ignoreDelete);
                    console.log('使用URI字符串成功创建监视器');
                    return watcher;
                } catch (error2) {
                    console.error('使用URI字符串创建监视器失败:', error2);
                }
            }
        }

        // 所有方法都失败了，尝试通用方法
        console.log('所有特定方法都失败，尝试通用方法');

        try {
            // 尝试使用通配符模式作为最后的手段
            const pattern = new vscode.RelativePattern(
                vscode.workspace.workspaceFolders?.[0] || '.',
                '**/' + path.basename(fileUri.toString())
            );
            watcher = vscode.workspace.createFileSystemWatcher(pattern, ignoreCreate, ignoreChange, ignoreDelete);
            console.log('使用通用方法成功创建监视器');
            return watcher;
        } catch (finalError) {
            console.error('所有创建监视器的方法均失败:', finalError);
            return undefined;
        }
    } catch (error) {
        console.error('创建平台感知监视器时发生错误:', error);
        return undefined;
    }
}

/**
 * 安全读取文件
 * 会尝试多种方法读取文件，适应不同环境
 * @param uri 文件URI
 * @returns 文件内容
 */
export async function safeReadFile(uri: vscode.Uri): Promise<Uint8Array> {
    try {
        console.log(`尝试读取文件: ${uri.toString()}`);

        // 从状态管理器获取环境信息
        const stateManager = StateManager.getInstance();
        const envInfo = stateManager.isStateInitialized() ?
            stateManager.getEnvironmentInfo() :
            getEnvironmentInfo(); // 如果状态管理器未初始化，则调用函数获取

        // 直接尝试读取
        try {
            return await vscode.workspace.fs.readFile(uri);
        } catch (error) {
            console.error('直接读取文件失败:', error);

            // 如果是在远程环境中，尝试其他方法
            if (envInfo.isRemote) {
                // 尝试使用不同格式的URI
                try {
                    // 方法1: 使用path而不是fsPath创建URI
                    const altUri1 = vscode.Uri.file(uri.path);
                    console.log(`尝试使用替代URI (path): ${altUri1.toString()}`);
                    return await vscode.workspace.fs.readFile(altUri1);
                } catch (error1) {
                    console.error('使用path创建URI读取失败:', error1);

                    // 方法2: 处理可能的路径格式问题
                    if (envInfo.remoteOSType === OSType.Linux && envInfo.localOSType === OSType.Windows) {
                        // Windows客户端连接到Linux主机
                        const pathStr = uri.fsPath;
                        if (pathStr.match(/^[A-Z]:\\/i)) {
                            // Windows路径转为Linux路径
                            const linuxPath = '/' + pathStr.substr(2).replace(/\\/g, '/');
                            const altUri2 = vscode.Uri.file(linuxPath);

                            try {
                                console.log(`尝试使用Linux格式路径: ${linuxPath}`);
                                return await vscode.workspace.fs.readFile(altUri2);
                            } catch (error2) {
                                console.error('使用Linux格式路径读取失败:', error2);
                            }
                        }
                    } else if (envInfo.remoteOSType === OSType.Windows && envInfo.localOSType !== OSType.Windows) {
                        // 非Windows客户端连接到Windows主机
                        const pathStr = uri.path;
                        if (pathStr.startsWith('/')) {
                            // Linux路径转为Windows路径
                            const winPath = 'C:' + pathStr.replace(/\//g, '\\');
                            const altUri3 = vscode.Uri.file(winPath);

                            try {
                                console.log(`尝试使用Windows格式路径: ${winPath}`);
                                return await vscode.workspace.fs.readFile(altUri3);
                            } catch (error3) {
                                console.error('使用Windows格式路径读取失败:', error3);
                            }
                        }
                    }
                }
            }

            // 所有方法都失败，重新抛出原始错误
            throw error;
        }
    } catch (error) {
        console.error('安全读取文件失败:', error);
        throw error;
    }
}

/**
 * 尝试通过执行远程命令来确定系统类型
 * 注意：这个函数是异步的，需要在完全异步环境中使用
 * 使用示例：
 * detectRemoteOSViaCommand().then(osType => {
 *   console.log(`检测到的操作系统: ${osType}`);
 * });
 * 
 * @returns Promise<OSType> 操作系统类型的Promise
 */
export async function detectRemoteOSViaCommand(): Promise<OSType> {
    return new Promise<OSType>((resolve) => {
        try {
            console.log('尝试通过执行命令检测远程系统类型');

            // 创建一个临时终端
            const terminal = vscode.window.createTerminal('OS Detection');

            // 准备命令输出接收器
            let commandOutput = '';

            // 创建临时文件名，用于存储命令输出
            const tempFileName = `os-detection-${Date.now()}.txt`;
            const tempFilePath = path.join(os.tmpdir(), tempFileName);

            // 输出环境变量并检查系统信息
            // 这个命令会在Windows、Linux和macOS上都能工作
            const detectionCommand = `
                echo "--- OS DETECTION START ---" > ${tempFilePath} &&
                echo "PATH: $PATH" >> ${tempFilePath} &&
                (uname -a || echo "uname not available") >> ${tempFilePath} &&
                (test -f /proc/version && cat /proc/version || echo "No /proc/version") >> ${tempFilePath} &&
                (test -f /etc/os-release && cat /etc/os-release || echo "No /etc/os-release") >> ${tempFilePath} &&
                (command -v sw_vers && sw_vers || echo "Not macOS") >> ${tempFilePath} &&
                (echo "Windows check: %OS%" || echo "Not Windows command shell") >> ${tempFilePath} &&
                echo "--- OS DETECTION END ---" >> ${tempFilePath} &&
                cat ${tempFilePath}
            `;

            console.log('执行系统检测命令');
            terminal.sendText(detectionCommand);

            // 等待命令执行完毕
            setTimeout(() => {
                terminal.dispose();

                // 尝试读取输出文件
                try {
                    if (fs.existsSync(tempFilePath)) {
                        const output = fs.readFileSync(tempFilePath, 'utf8');
                        console.log('命令输出:', output);

                        // 解析输出以确定系统类型
                        if (output.includes('Linux') || output.includes('linux')) {
                            resolve(OSType.Linux);
                        } else if (output.includes('Darwin') || output.includes('macOS')) {
                            resolve(OSType.MacOS);
                        } else if (output.includes('Windows') || output.includes('WINDOWS')) {
                            resolve(OSType.Windows);
                        } else {
                            // 默认为Linux
                            console.log('无法从命令输出确定系统类型，默认为Linux');
                            resolve(OSType.Linux);
                        }

                        // 清理临时文件
                        try {
                            fs.unlinkSync(tempFilePath);
                        } catch (error) {
                            console.error('清理临时文件失败:', error);
                        }
                    } else {
                        console.log('临时文件不存在，无法读取命令输出');
                        resolve(OSType.Linux);
                    }
                } catch (fileError) {
                    console.error('读取命令输出文件失败:', fileError);
                    resolve(OSType.Linux);
                }
            }, 5000); // 给命令执行留出5秒时间

        } catch (error) {
            console.error('通过命令检测远程系统类型失败:', error);
            resolve(OSType.Linux);
        }
    });
}

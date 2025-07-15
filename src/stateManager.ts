import * as vscode from 'vscode';
import { EnvironmentInfo, OSType } from './pathUtils';

/**
 * 全局状态管理类
 * 用于存储和管理扩展的全局状态
 */
export class StateManager {
    private static instance: StateManager;
    private environmentInfo: EnvironmentInfo | undefined;
    private isInitialized: boolean = false;

    /**
     * 私有构造函数，防止外部实例化
     */
    private constructor() { }

    /**
     * 获取单例实例
     * @returns StateManager 实例
     */
    public static getInstance(): StateManager {
        if (!StateManager.instance) {
            StateManager.instance = new StateManager();
        }
        return StateManager.instance;
    }

    /**
     * 初始化状态管理器
     * @param envInfo 环境信息
     */
    public initialize(envInfo: EnvironmentInfo): void {
        if (this.isInitialized) {
            console.log('状态管理器已经初始化过，跳过');
            return;
        }

        this.environmentInfo = envInfo;
        this.isInitialized = true;
        console.log('状态管理器初始化完成:', JSON.stringify(this.environmentInfo, null, 2));
    }

    /**
     * 获取环境信息
     * @returns 环境信息对象
     */
    public getEnvironmentInfo(): EnvironmentInfo {
        if (!this.environmentInfo) {
            throw new Error('环境信息未初始化，请先调用initialize方法');
        }
        return this.environmentInfo;
    }

    /**
     * 检查是否为远程环境
     * @returns 是否为远程环境
     */
    public isRemoteEnvironment(): boolean {
        return this.getEnvironmentInfo().isRemote;
    }

    /**
     * 获取本地操作系统类型
     * @returns 操作系统类型
     */
    public getLocalOSType(): OSType {
        return this.getEnvironmentInfo().localOSType;
    }

    /**
     * 获取远程操作系统类型
     * @returns 操作系统类型
     */
    public getRemoteOSType(): OSType {
        return this.getEnvironmentInfo().remoteOSType;
    }

    /**
     * 获取活动操作系统类型（如果是远程环境则返回远程类型，否则返回本地类型）
     * @returns 操作系统类型
     */
    public getActiveOSType(): OSType {
        const envInfo = this.getEnvironmentInfo();
        return envInfo.isRemote ? envInfo.remoteOSType : envInfo.localOSType;
    }

    /**
     * 获取远程类型
     * @returns 远程类型
     */
    public getRemoteType(): string | undefined {
        return this.getEnvironmentInfo().remoteType;
    }

    /**
     * 判断状态管理器是否已初始化
     * @returns 是否已初始化
     */
    public isStateInitialized(): boolean {
        return this.isInitialized;
    }
}

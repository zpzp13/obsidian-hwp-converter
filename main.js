const { Plugin, Notice, Modal, Setting, PluginSettingTab } = require("obsidian");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const DEFAULT_SETTINGS = {
    defaultExportPath: process.env.USERPROFILE + "\\Desktop"
};

class HwpConverterSettingTab extends PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display() {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl("h2", { text: "HWP 변환 설정" });

        new Setting(containerEl)
            .setName("기본 저장 경로")
            .setDesc("파일이 저장될 기본 폴더 경로입니다.")
            .addText((text) =>
                text
                    .setPlaceholder(process.env.USERPROFILE + "\\Desktop")
                    .setValue(this.plugin.settings.defaultExportPath)
                    .onChange(async (value) => {
                        this.plugin.settings.defaultExportPath = value;
                        await this.plugin.saveSettings();
                    })
            );
    }
}

class HwpExportModal extends Modal {
    constructor(app, plugin, target, defaultPath, onSubmit) {
        super(app);
        this.plugin = plugin;
        this.target = target; // File or Folder
        this.resultPath = defaultPath;
        this.onSubmit = onSubmit;

        this.useSpaceIndent = false;

        // Determine Mode: If target has 'children', it's a folder (TFolder), otherwise TFile
        this.mode = target.children ? 'batch' : 'single';
        // For single mode, just the basename (extension excluded for display)
        this.resultName = this.mode === 'single' ? target.basename : "";
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        if (this.mode === 'single') {
            contentEl.createEl("h2", { text: "한글(HWP)로 내보내기" });
        } else {
            contentEl.createEl("h2", { text: `폴더 내보내기: ${this.target.name}` });
            contentEl.createEl("p", { text: "이 폴더 내의 모든 마크다운 파일이 변환됩니다." });
        }

        // File Name Input (Only for Single)
        if (this.mode === 'single') {
            const fileSetting = new Setting(contentEl)
                .setName("파일 이름")
                .setDesc("내보낼 파일의 이름을 입력하세요.");

            fileSetting.addText((text) =>
                text
                    .setValue(this.resultName)
                    .onChange((value) => {
                        this.resultName = value;
                    })
            );

            // Add CSS class for styling via styles.css
            fileSetting.setClass("hwp-filename-setting");

            const extEl = fileSetting.controlEl.createEl("span", {
                text: ".hwp",
                cls: "hwp-filename-extension"
            });
        }

        // Export Path Input with Folder Button
        const pathSetting = new Setting(contentEl)
            .setName("저장 경로")
            .setDesc("파일이 저장될 폴더를 선택하세요.");

        pathSetting.addText((text) => {
            text
                .setValue(this.resultPath)
                .onChange((value) => {
                    this.resultPath = value;
                });
            this.pathComponent = text;
        });

        // Use addExtraButton for a clean icon
        pathSetting.addExtraButton((btn) =>
            btn
                .setIcon("folder")
                .setTooltip("폴더 선택")
                .onClick(async () => {
                    const picked = await this.plugin.openFolderPicker();
                    if (picked) {
                        this.resultPath = picked;
                        if (this.pathComponent) {
                            this.pathComponent.setValue(picked);
                        }
                    }
                })
        );

        // Indentation Toggle
        new Setting(contentEl)
            .setName("문단 들여쓰기")
            .setDesc("각 문단 시작에 띄어쓰기 한 칸을 추가합니다.")
            .addToggle((toggle) =>
                toggle
                    .setValue(this.useSpaceIndent)
                    .onChange((value) => {
                        this.useSpaceIndent = value;
                    })
            );

        new Setting(contentEl)
            .addButton((btn) =>
                btn
                    .setButtonText(this.mode === 'single' ? "내보내기" : "일괄 내보내기")
                    .setCta()
                    .onClick(() => {
                        this.close();
                        const finalName = this.mode === 'single' ? this.resultName + ".hwp" : "";
                        this.onSubmit(finalName, this.resultPath, this.mode, this.useSpaceIndent);
                    })
            );
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

module.exports = class HwpConverterPlugin extends Plugin {
    async onload() {
        console.log("Loading HWP Converter Plugin");

        await this.loadSettings();

        this.addSettingTab(new HwpConverterSettingTab(this.app, this));

        // Command (Single Active File)
        this.addCommand({
            id: "convert-to-hwp",
            name: "한글(HWP)로 변환",
            checkCallback: (checking) => {
                const activeFile = this.app.workspace.getActiveFile();
                if (activeFile) {
                    if (!checking) {
                        this.openExportModal(activeFile);
                    }
                    return true;
                }
                return false;
            },
        });

        // Context Menu (File Explorer)
        this.registerEvent(
            this.app.workspace.on("file-menu", (menu, file) => {
                if (file.extension === 'md') {
                    menu.addItem((item) => {
                        item
                            .setTitle("한글(HWP)로 내보내기")
                            .setIcon("document")
                            .onClick(() => {
                                this.openExportModal(file);
                            });
                    });
                } else if (file.children) {
                    // Folder
                    menu.addItem((item) => {
                        item
                            .setTitle("한글(HWP)로 폴더 내보내기")
                            .setIcon("folder")
                            .onClick(() => {
                                this.openExportModal(file);
                            });
                    });
                }
            })
        );
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

        // Self-healing: Fix known corrupted default path
        if (this.settings.defaultExportPath === "s\\82109\\DeskC:\\User\\desktop") {
            this.settings.defaultExportPath = process.env.USERPROFILE + "\\Desktop";
            console.log("Fixed corrupted default export path setting automatically.");
            await this.saveSettings();
        }
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    openExportModal(target) {
        let defaultPath = this.settings.defaultExportPath;
        if (!defaultPath) {
            defaultPath = process.env.USERPROFILE + "\\Desktop";
        }

        new HwpExportModal(this.app, this, target, defaultPath, (name, exportPath, mode, useSpaceIndent) => {
            if (mode === 'single') {
                this.convertNote(target, name, exportPath, false, useSpaceIndent);
            } else {
                this.convertFolder(target, exportPath, useSpaceIndent);
            }
        }).open();
    }

    async openFolderPicker() {
        const adapter = this.app.vault.adapter;
        const pluginDir = path.join(adapter.getBasePath(), this.manifest.dir);
        const scriptDir = path.join(pluginDir, "scripts");
        const scriptFile = "converter.py";
        const fullScriptPath = path.join(scriptDir, scriptFile);

        console.log(`[HWP Plugin] Script Dir: ${scriptDir}`);

        if (!fs.existsSync(scriptDir)) {
            new Notice(`오류: 플러그인 scripts 폴더를 찾을 수 없습니다.\n${scriptDir}`, 5000);
            return null;
        }
        if (!fs.existsSync(fullScriptPath)) {
            new Notice(`오류: converter.py 파일을 찾을 수 없습니다.\n${fullScriptPath}`, 5000);
            return null;
        }

        return new Promise((resolve, reject) => {
            const process = spawn("python", [scriptFile, "--pick-folder"], { cwd: scriptDir });
            let output = "";

            process.stdout.on("data", (data) => {
                output += data.toString();
            });

            process.on("error", (err) => {
                new Notice(`Python 실행 실패. Python이 설치되어 있는지 확인하세요.\n${err.message}`, 5000);
                console.error("Spawn Error:", err);
                resolve(null); // Resolve null to avoid hanging
            });

            process.on("close", (code) => {
                const trimmed = output.trim();
                if (code === 0 && trimmed) {
                    resolve(trimmed);
                } else {
                    resolve(null);
                }
            });
        });
    }

    async convertFolder(folder, exportPath, useSpaceIndent) {
        const adapter = this.app.vault.adapter;
        const pluginDir = path.join(adapter.getBasePath(), this.manifest.dir);
        const scriptDir = path.join(pluginDir, "scripts");
        const scriptFile = "converter.py";
        const fullScriptPath = path.join(scriptDir, scriptFile);

        const absoluteFolderPath = path.join(adapter.getBasePath(), folder.path);

        if (!fs.existsSync(scriptDir) || !fs.existsSync(fullScriptPath)) {
            new Notice(`오류: 스크립트 파일을 찾을 수 없습니다. 설치를 확인해주세요.`, 5000);
            return false;
        }

        new Notice(`폴더 변환 시작: ${folder.name}`, 3000);

        return new Promise((resolve) => {
            const args = [scriptFile, "--batch-folder", absoluteFolderPath, exportPath];
            if (useSpaceIndent) {
                args.push("--space-indent");
            }

            const pythonProcess = spawn("python", args, { cwd: scriptDir });

            pythonProcess.stdout.on("data", (data) => {
                // Optional: Parse output to show progress if needed, e.g. "Converted: ..."
                console.log(`[Python]: ${data}`);
            });

            pythonProcess.stderr.on("data", (data) => {
                console.error(`[Python Error]: ${data}`);
            });

            pythonProcess.on("error", (err) => {
                new Notice(`Python 실행 오류! Python 설치 및 PATH 설정을 확인하세요.\n${err.message}`, 5000);
                resolve(false);
            });

            pythonProcess.on("close", (code) => {
                if (code === 0) {
                    new Notice(`일괄 변환 완료!`, 5000);
                    resolve(true);
                } else {
                    new Notice(`일괄 변환 중 오류가 발생했습니다.`, 5000);
                    resolve(false);
                }
            });
        });
    }

    async convertNote(file, fileName, exportPath, silent = false, useSpaceIndent = false) {
        if (!silent) new Notice("HWP로 변환 중...", 5000);

        const adapter = this.app.vault.adapter;
        const absolutePath = path.join(adapter.getBasePath(), file.path);
        const safeExportPath = exportPath.replace(/[\\/]$/, "");
        const fullOutputPath = path.join(safeExportPath, fileName);

        const pluginDir = path.join(adapter.getBasePath(), this.manifest.dir);
        const scriptDir = path.join(pluginDir, "scripts");
        const scriptFile = "converter.py";
        const fullScriptPath = path.join(scriptDir, scriptFile);

        if (!fs.existsSync(scriptDir) || !fs.existsSync(fullScriptPath)) {
            if (!silent) new Notice(`오류: 스크립트 폴더 또는 파일이 없습니다.`, 5000);
            return false;
        }

        return new Promise((resolve) => {
            const args = [scriptFile, absolutePath, fullOutputPath];
            if (useSpaceIndent) {
                args.push("--space-indent");
            }

            const pythonProcess = spawn("python", args, { cwd: scriptDir });

            pythonProcess.stderr.on("data", (data) => {
                console.error(`[Python Error]: ${data}`);
            });

            pythonProcess.on("error", (err) => {
                if (!silent) new Notice(`Python 실행 오류! Python 설치 및 PATH 설정을 확인하세요.\n${err.message}`, 5000);
                resolve(false);
            });

            pythonProcess.on("close", (code) => {
                if (code === 0) {
                    if (!silent) new Notice(`저장 완료: ${fileName}`, 3000);
                    resolve(true);
                } else {
                    if (!silent) new Notice(`실패: ${fileName}`, 3000);
                    resolve(false);
                }
            });
        });
    }

    onunload() {
        console.log("Unloading HWP Converter Plugin");
    }
};

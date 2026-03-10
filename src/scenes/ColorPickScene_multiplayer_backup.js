import Phaser from 'phaser';
import { COLORS, DARK_COLORS } from '../constants';

const COLOR_DATA = [
    { key: 'RED',    hex: COLORS.RED,    label: 'Vermelho', darkHex: DARK_COLORS.RED },
    { key: 'BLUE',   hex: COLORS.BLUE,   label: 'Azul',     darkHex: DARK_COLORS.BLUE },
    { key: 'YELLOW', hex: COLORS.YELLOW, label: 'Amarelo',  darkHex: DARK_COLORS.YELLOW },
    { key: 'GREEN',  hex: COLORS.GREEN,  label: 'Verde',    darkHex: DARK_COLORS.GREEN },
];

export class ColorPickScene extends Phaser.Scene {
    constructor() {
        super('ColorPickScene');
    }

    init(data) {
        this.mode = data?.mode || 'IA';
        this.selectedColors = [];
        this.playerCount = (this.mode === 'LOCAL') ? 4 : 1;
    }

    preload() {
        this.load.image('menu_bg', '/menu_bg.png');
    }

    create() {
        const cx = this.cameras.main.centerX;
        const cy = this.cameras.main.centerY;
        const W = this.cameras.main.width;
        const H = this.cameras.main.height;

        // Background
        const bg = this.add.image(cx, cy, 'menu_bg');
        bg.setScale(Math.max(W / bg.width, H / bg.height) || 1);

        // Dark overlay
        this.add.rectangle(0, 0, W, H, 0x000000, 0.6).setOrigin(0);

        // Back button
        const backBtn = this.add.text(30, 30, '← Voltar', {
            fontSize: '17px',
            fontFamily: 'Arial',
            fill: '#ffffff',
            backgroundColor: '#333333',
            padding: { x: 10, y: 6 }
        })
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => this.scene.start('MenuScene'));

        // Title
        this.titleText = this.add.text(cx, 80, this.mode === 'LOCAL' ? 'Configurar Jogo Local' : 'Escolha sua Cor', {
            fontSize: '36px',
            fontFamily: 'Arial Black, Arial',
            fontWeight: 'bold',
            fill: '#ffffff',
            shadow: { offsetX: 2, offsetY: 3, color: '#000', blur: 8, fill: true }
        }).setOrigin(0.5);

        this.instructionText = this.add.text(cx, 130, '', {
            fontSize: '17px',
            fontFamily: 'Arial',
            fill: '#aaaaaa'
        }).setOrigin(0.5);

        if (this.mode === 'LOCAL') {
            this.createPlayerCountSelector(cx, 180);
        }

        // Color cards — 2x2 grid
        const gridY = this.mode === 'LOCAL' ? cy + 60 : cy + 20;
        const positions = [
            { x: cx - 110, y: gridY - 95 },
            { x: cx + 110, y: gridY - 95 },
            { x: cx - 110, y: gridY + 95 },
            { x: cx + 110, y: gridY + 95 },
        ];

        this.cards = [];
        COLOR_DATA.forEach((cd, i) => {
            const card = this.createColorCard(positions[i].x, positions[i].y, cd);
            this.cards.push({ card, data: cd });
        });

        // Start Button (Hidden until requirements met)
        this.createStartButton(cx, H - 60);

        this.refreshUI();
    }

    createPlayerCountSelector(x, y) {
        const counts = [2, 3, 4];
        this.countButtons = [];

        counts.forEach((num, i) => {
            const btnX = x + (i - 1) * 110;
            const container = this.add.container(btnX, y);
            
            const bg = this.add.graphics();
            const txt = this.add.text(0, 0, `${num} Jog.`, {
                fontSize: '16px',
                fontFamily: 'Arial',
                fontWeight: 'bold',
                fill: '#ffffff'
            }).setOrigin(0.5);

            container.add([bg, txt]);
            container.setInteractive(new Phaser.Geom.Rectangle(-45, -20, 90, 40), Phaser.Geom.Rectangle.Contains, { useHandCursor: true });
            
            container.on('pointerdown', () => {
                this.playerCount = num;
                this.selectedColors = [];
                this.refreshUI();
            });

            this.countButtons.push({ bg, num });
        });
    }

    createStartButton(x, y) {
        this.startBtn = this.add.container(x, y);
        this.startBtnBg = this.add.graphics();
        this.startBtnBg.fillStyle(0x4CAF50, 1);
        this.startBtnBg.fillRoundedRect(-100, -25, 200, 50, 25);
        this.startBtnBg.lineStyle(2, 0xffffff, 1);
        this.startBtnBg.strokeRoundedRect(-100, -25, 200, 50, 25);

        this.startBtnLabel = this.add.text(0, 0, 'COMEÇAR JOGO', {
            fontSize: '18px',
            fontFamily: 'Arial Black, Arial',
            fill: '#ffffff'
        }).setOrigin(0.5);

        this.startBtn.add([this.startBtnBg, this.startBtnLabel]);
        this.startBtn.setAlpha(0); // Hidden initially

        const hitArea = new Phaser.Geom.Rectangle(-100, -25, 200, 50);
        this.startBtn.setInteractive(hitArea, Phaser.Geom.Rectangle.Contains, { useHandCursor: true });
        
        this.startBtn.on('pointerdown', () => {
            this.startGame(this.selectedColors);
        });
    }

    refreshUI() {
        // Update Instruction
        if (this.mode === 'LOCAL') {
            const remaining = this.playerCount - this.selectedColors.length;
            if (remaining > 0) {
                this.instructionText.setText(`Selecione ${remaining} cor(es) para os jogadores:`).setFill('#aaaaaa');
            } else {
                this.instructionText.setText('Todos os jogadores selecionados!').setFill('#4CAF50');
            }
        } else {
            this.instructionText.setText('Clique no pino para jogar com essa cor').setFill('#aaaaaa');
        }

        // Update Start Button Visibility
        const isReady = (this.mode === 'LOCAL' && this.selectedColors.length === this.playerCount);
        this.tweens.add({
            targets: this.startBtn,
            alpha: isReady ? 1 : 0,
            y: isReady ? this.cameras.main.height - 80 : this.cameras.main.height - 60,
            duration: 250,
            ease: 'Back.easeOut'
        });

        // Update counts
        if (this.countButtons) {
            this.countButtons.forEach(btn => {
                btn.bg.clear();
                btn.bg.fillStyle(btn.num === this.playerCount ? 0x2196F3 : 0x333333, 1);
                btn.bg.fillRoundedRect(-45, -20, 90, 40, 10);
                btn.bg.lineStyle(2, 0xffffff, btn.num === this.playerCount ? 1 : 0.3);
                btn.bg.strokeRoundedRect(-45, -20, 90, 40, 10);
            });
        }

        // Update cards
        this.cards.forEach(c => {
            const index = this.selectedColors.indexOf(c.data.key);
            const isSelected = index !== -1;
            
            c.card.rankText.setVisible(isSelected);
            if (isSelected) c.card.rankText.setText(`JOGADOR ${index + 1}`);
            
            c.card.container.setAlpha(isSelected || this.selectedColors.length < this.playerCount || this.mode === 'IA' ? 1 : 0.4);
            c.card.btnLabel.setText(isSelected ? 'SELECIONADO' : (this.mode === 'IA' ? 'JOGAR' : 'SELECIONAR'));
        });
    }

    createColorCard(x, y, cd) {
        const container = this.add.container(x, y);
        const w = 160, h = 180;

        const shadow = this.add.graphics();
        shadow.fillStyle(0x000000, 0.4);
        shadow.fillRoundedRect(-w/2 + 4, -h/2 + 6, w, h, 22);

        const card = this.add.graphics();
        card.fillStyle(0x1a1a2e, 1);
        card.fillRoundedRect(-w/2, -h/2, w, h, 22);
        card.fillStyle(cd.hex, 0.9);
        card.fillRoundedRect(-w/2, -h/2, w, 14, { tl: 22, tr: 22 });
        card.lineStyle(3, cd.hex, 1);
        card.strokeRoundedRect(-w/2, -h/2, w, h, 22);

        const pawn = this.drawPawn(cd.hex, cd.darkHex);

        const label = this.add.text(0, h/2 - 38, cd.label.toUpperCase(), {
            fontSize: '16px', fontFamily: 'Arial Black, Arial', fontWeight: 'bold', fill: '#ffffff'
        }).setOrigin(0.5);

        const rankText = this.add.text(0, -h/2 + 35, '', {
            fontSize: '14px', fontFamily: 'Arial Black, Arial', fill: '#4CAF50', fontWeight: 'bold'
        }).setOrigin(0.5).setVisible(false);

        const btnLabel = this.add.text(0, h/2 - 11, '', {
            fontSize: '11px', fontFamily: 'Arial Black, Arial', fontWeight: 'bold', fill: '#ffffff'
        }).setOrigin(0.5);

        const hoverOverlay = this.add.graphics();
        hoverOverlay.fillStyle(0xffffff, 0.08);
        hoverOverlay.fillRoundedRect(-w/2, -h/2, w, h, 22);
        hoverOverlay.setAlpha(0);

        container.add([shadow, card, pawn, label, rankText, btnLabel, hoverOverlay]);
        container.setInteractive(new Phaser.Geom.Rectangle(-w/2, -h/2, w, h), Phaser.Geom.Rectangle.Contains, { useHandCursor: true });

        container.on('pointerdown', () => {
            if (this.mode === 'IA') {
                this.startGame([cd.key]);
                return;
            }

            if (this.selectedColors.includes(cd.key)) {
                this.selectedColors = this.selectedColors.filter(c => c !== cd.key);
            } else if (this.selectedColors.length < this.playerCount) {
                this.selectedColors.push(cd.key);
            }
            this.refreshUI();
        });

        return { container, rankText, btnLabel };
    }

    startGame(activeColors) {
        // Clone the array to avoid reference issues
        const players = [...activeColors];
        
        // If IA mode, we only picked 1 color, but logic needs knowledge of all participants
        // In IA mode, the GameScene will handle assigning aiPlayers to everything except the first entry
        let finalActivePlayers = players;
        if (this.mode === 'IA') {
            finalActivePlayers = ['RED', 'BLUE', 'YELLOW', 'GREEN'];
        }

        this.scene.start('GameScene', {
            mode: this.mode,
            activePlayers: finalActivePlayers,
            playerColor: players[0]
        });
    }

    drawPawn(color, darkColor) {
        const g = this.add.graphics();
        const y = -10;
        g.fillStyle(0x000000, 0.25);
        g.fillEllipse(0, y + 46, 44, 16);
        g.fillStyle(color, 1);
        g.lineStyle(2.5, darkColor, 1);
        g.fillEllipse(0, y + 36, 44, 18);
        g.strokeEllipse(0, y + 36, 44, 18);
        g.beginPath();
        g.moveTo(-20, y + 36); g.lineTo(-10, y + 4); g.lineTo(10, y + 4); g.lineTo(20, y + 36);
        g.closePath(); g.fillPath(); g.strokePath();
        g.fillCircle(0, y - 4, 18); g.strokeCircle(0, y - 4, 18);
        g.fillStyle(0xffffff, 0.4); g.fillCircle(-6, y - 10, 6);
        return g;
    }
}

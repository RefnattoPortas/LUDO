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
        this.playerCount = (this.mode === 'LOCAL') ? 4 : 2; 
    }

    preload() {
        this.load.image('color_pick_bg', '/color_pick_bg.png');
    }

    create() {
        const cx = this.cameras.main.centerX;
        const cy = this.cameras.main.centerY;
        const W = this.cameras.main.width;
        const H = this.cameras.main.height;

        // Background
        const bg = this.add.image(cx, cy, 'color_pick_bg');
        bg.setScale(Math.max(W / bg.width, H / bg.height) || 1);

        // Dark overlay
        this.add.rectangle(0, 0, W, H, 0x000000, 0.6).setOrigin(0);

        // Back button
        const backBtn = this.add.text(30, 30, '← Voltar', {
            fontSize: '17px', fontFamily: 'Arial', fill: '#ffffff',
            backgroundColor: '#333333', padding: { x: 10, y: 6 }
        })
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => this.scene.start('MenuScene'));

        // Title
        this.titleText = this.add.text(cx, 80, this.mode === 'LOCAL' ? 'Multijogador Local' : 'Duelo contra I.A.', {
            fontSize: '36px', fontFamily: 'Arial Black, Arial', fontWeight: 'bold', fill: '#ffffff',
            shadow: { offsetX: 2, offsetY: 3, color: '#000', blur: 8, fill: true }
        }).setOrigin(0.5);

        this.instructionText = this.add.text(cx, 130, '', {
            fontSize: '17px', fontFamily: 'Arial', fill: '#aaaaaa'
        }).setOrigin(0.5);

        // Player Count Selector
        this.createPlayerCountSelector(cx, 180);

        // Color cards — 2x2 grid (Reduced size by 30% and brought closer)
        const gridY = cy + 50;
        const gapX = 75; // Smaller horizontal gap
        const gapY = 85; // Smaller vertical gap
        const positions = [
            { x: cx - gapX, y: gridY - gapY }, { x: cx + gapX, y: gridY - gapY },
            { x: cx - gapX, y: gridY + gapY }, { x: cx + gapX, y: gridY + gapY },
        ];

        this.cards = [];
        COLOR_DATA.forEach((cd, i) => {
            const card = this.createColorCard(positions[i].x, positions[i].y, cd);
            this.cards.push({ card, data: cd });
        });

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
                fontSize: '16px', fontFamily: 'Arial Black', fontWeight: 'bold', fill: '#ffffff'
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
        this.startBtnLabel = this.add.text(0, 0, 'COMEÇAR', {
            fontSize: '18px', fontFamily: 'Arial Black', fill: '#ffffff'
        }).setOrigin(0.5);
        this.startBtn.add([this.startBtnBg, this.startBtnLabel]);
        this.startBtn.setAlpha(0);
        this.startBtn.setInteractive(new Phaser.Geom.Rectangle(-100, -25, 200, 50), Phaser.Geom.Rectangle.Contains, { useHandCursor: true });
        this.startBtn.on('pointerdown', () => this.startGame(this.selectedColors));
    }

    refreshUI() {
        if (this.mode === 'LOCAL') {
            const remaining = this.playerCount - this.selectedColors.length;
            this.instructionText.setText(remaining > 0 ? `Selecione ${remaining} cores:` : 'Pronto para começar!').setFill(remaining > 0 ? '#aaa' : '#4CAF50');
        } else {
            this.instructionText.setText(this.selectedColors.length === 1 ? 'Cor escolhida!' : 'Escolha sua cor para o duelo:').setFill(this.selectedColors.length === 1 ? '#4CAF50' : '#aaa');
        }

        const isReady = (this.mode === 'LOCAL' ? this.selectedColors.length === this.playerCount : this.selectedColors.length === 1);
        this.tweens.add({ targets: this.startBtn, alpha: isReady ? 1 : 0, y: isReady ? this.cameras.main.height - 80 : this.cameras.main.height - 60, duration: 250 });

        if (this.countButtons) {
            this.countButtons.forEach(btn => {
                btn.bg.clear().fillStyle(btn.num === this.playerCount ? 0x2196F3 : 0x333333, 1).fillRoundedRect(-45, -20, 90, 40, 10);
                btn.bg.lineStyle(2, 0xffffff, btn.num === this.playerCount ? 1 : 0.3).strokeRoundedRect(-45, -20, 90, 40, 10);
            });
        }

        this.cards.forEach(c => {
            const index = this.selectedColors.indexOf(c.data.key);
            const isSelected = index !== -1;
            c.card.badge.setVisible(isSelected);
            if (isSelected) {
                c.card.badge.setText(this.mode === 'LOCAL' ? `JOGADOR ${index + 1}` : 'VOCÊ');
                c.card.border.clear().lineStyle(3, c.data.hex, 1).strokeRoundedRect(-60, -70, 120, 140, 18);
                c.card.glow.setVisible(true);
            } else {
                c.card.border.clear().lineStyle(1.5, 0xffffff, 0.2).strokeRoundedRect(-60, -70, 120, 140, 18);
                c.card.glow.setVisible(false);
            }
            c.card.container.setAlpha(isSelected || this.selectedColors.length < this.playerCount || this.mode === 'IA' ? 1 : 0.4);
            c.card.btnLabel.setText(isSelected ? 'PRONTO' : 'ESCOLHER');
        });
    }

    createColorCard(x, y, cd) {
        const container = this.add.container(x, y);
        const w = 120, h = 140; // 30% smaller (approx)
        const bg = this.add.graphics();
        // Glassmorphism effect
        bg.fillStyle(0x1a1a2e, 0.7);
        bg.fillRoundedRect(-w/2, -h/2, w, h, 18);
        
        const border = this.add.graphics();
        border.lineStyle(1.5, 0xffffff, 0.2);
        border.strokeRoundedRect(-w/2, -h/2, w, h, 18);
        
        const glow = this.add.graphics();
        glow.fillStyle(cd.hex, 0.25);
        glow.fillRoundedRect(-w/2 - 4, -h/2 - 4, w + 8, h + 8, 22);
        glow.setVisible(false);
        
        const pawn = this.drawPawn(cd.hex, cd.darkHex);
        pawn.setScale(0.85); // Scaled pawn down
        pawn.y = -5;
        
        const label = this.add.text(0, h/2 - 32, cd.label.toUpperCase(), {
            fontSize: '13px', fontFamily: 'Arial Black', fill: '#ffffff'
        }).setOrigin(0.5);
        
        const badge = this.add.text(0, -h/2 + 18, '', {
            fontSize: '9px', fontFamily: 'Arial Black', fill: '#ffffff',
            backgroundColor: cd.hex, padding: { x: 6, y: 3 }
        }).setOrigin(0.5).setVisible(false);
        
        const btnLabel = this.add.text(0, h/2 - 12, 'ESCOLHER', {
            fontSize: '9px', fontFamily: 'Arial Black', fill: '#777777'
        }).setOrigin(0.5);

        container.add([glow, bg, border, pawn, label, badge, btnLabel]);
        
        container.setInteractive(new Phaser.Geom.Rectangle(-w/2, -h/2, w, h), Phaser.Geom.Rectangle.Contains, { useHandCursor: true });
        
        container.on('pointerdown', () => {
            if (this.mode === 'IA') { this.selectedColors = [cd.key]; } 
            else {
                if (this.selectedColors.includes(cd.key)) { this.selectedColors = this.selectedColors.filter(c => c !== cd.key); } 
                else if (this.selectedColors.length < this.playerCount) { this.selectedColors.push(cd.key); }
            }
            this.refreshUI();
            this.cameras.main.shake(100, 0.005);
        });

        container.on('pointerover', () => { 
            this.tweens.add({ targets: container, scale: 1.05, duration: 200 });
            this.tweens.add({ targets: container, y: y - 8, duration: 200 });
        });
        container.on('pointerout', () => { 
            this.tweens.add({ targets: container, scale: 1, duration: 200 });
            this.tweens.add({ targets: container, y: y, duration: 200 });
        });
        
        return { container, badge, btnLabel, border, glow };
    }

    startGame(activeColors) {
        const players = [...activeColors];
        let finalActivePlayers = [];
        if (this.mode === 'IA') {
            const userColor = players[0];
            finalActivePlayers = [userColor];
            COLOR_DATA.forEach(cd => { if (cd.key !== userColor && finalActivePlayers.length < this.playerCount) { finalActivePlayers.push(cd.key); }});
        } else { finalActivePlayers = players; }
        this.scene.start('GameScene', { mode: this.mode, activePlayers: finalActivePlayers, playerColor: players[0] });
    }

    drawPawn(color, darkColor) {
        const g = this.add.graphics();
        const y = -10;
        g.fillStyle(0x000000, 0.2); g.fillEllipse(0, y + 46, 40, 14);
        g.fillStyle(color, 1); g.lineStyle(2, darkColor, 1);
        g.fillEllipse(0, y + 36, 40, 16); g.strokeEllipse(0, y + 36, 40, 16);
        g.beginPath(); g.moveTo(-18, y + 36); g.lineTo(-8, y + 4); g.lineTo(8, y + 4); g.lineTo(18, y + 36);
        g.closePath(); g.fillPath(); g.strokePath();
        g.fillCircle(0, y - 4, 16); g.strokeCircle(0, y - 4, 16);
        g.fillStyle(0xffffff, 0.3); g.fillCircle(-5, y - 9, 5);
        return g;
    }
}

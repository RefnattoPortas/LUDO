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

        // Title
        this.add.text(cx, 90, 'Escolha sua Cor', {
            fontSize: '40px',
            fontFamily: 'Arial Black, Arial',
            fontWeight: 'bold',
            fill: '#ffffff',
            shadow: { offsetX: 2, offsetY: 3, color: '#000', blur: 8, fill: true }
        }).setOrigin(0.5);

        this.add.text(cx, 145, 'Clique no pino para jogar com essa cor', {
            fontSize: '17px',
            fontFamily: 'Arial',
            fill: '#aaaaaa'
        }).setOrigin(0.5);

        // Color cards — 2x2 grid
        const positions = [
            { x: cx - 110, y: cy - 90 },
            { x: cx + 110, y: cy - 90 },
            { x: cx - 110, y: cy + 100 },
            { x: cx + 110, y: cy + 100 },
        ];

        COLOR_DATA.forEach((cd, i) => {
            this.createColorCard(positions[i].x, positions[i].y, cd);
        });

        // Back button
        this.add.text(30, 30, '← Voltar', {
            fontSize: '17px',
            fontFamily: 'Arial',
            fill: '#ffffff',
            backgroundColor: '#333333',
            padding: { x: 10, y: 6 }
        })
        .setInteractive({ useHandCursor: true })
        .setDepth(100)
        .on('pointerdown', () => {
            this.scene.start('MenuScene');
        });
    }

    createColorCard(x, y, cd) {
        const container = this.add.container(x, y);
        const w = 160, h = 175;

        // Card shadow
        const shadow = this.add.graphics();
        shadow.fillStyle(0x000000, 0.4);
        shadow.fillRoundedRect(-w/2 + 4, -h/2 + 6, w, h, 22);

        // Card background with gradient feel
        const card = this.add.graphics();
        card.fillStyle(0x1a1a2e, 1);
        card.fillRoundedRect(-w/2, -h/2, w, h, 22);

        // Colored top accent bar
        card.fillStyle(cd.hex, 0.9);
        card.fillRoundedRect(-w/2, -h/2, w, 14, { tl: 22, tr: 22, bl: 0, br: 0 });

        // Neon border
        card.lineStyle(3, cd.hex, 1);
        card.strokeRoundedRect(-w/2, -h/2, w, h, 22);

        // White inner glow line
        card.lineStyle(1.5, 0xffffff, 0.15);
        card.strokeRoundedRect(-w/2 + 4, -h/2 + 4, w - 8, h - 8, 18);

        // Pawn drawing
        const pawn = this.drawPawn(cd.hex, cd.darkHex);

        // Color label
        const label = this.add.text(0, h/2 - 38, cd.label.toUpperCase(), {
            fontSize: '16px',
            fontFamily: 'Arial Black, Arial',
            fontWeight: 'bold',
            fill: '#ffffff',
            shadow: { offsetX: 1, offsetY: 1, color: '#000', blur: 3, fill: true }
        }).setOrigin(0.5);

        // "Jogar" pill button inside card
        const btnBg = this.add.graphics();
        btnBg.fillStyle(cd.hex, 1);
        btnBg.fillRoundedRect(-55, h/2 - 26, 110, 30, 15);
        btnBg.lineStyle(1.5, 0xffffff, 0.4);
        btnBg.strokeRoundedRect(-55, h/2 - 26, 110, 30, 15);

        const btnLabel = this.add.text(0, h/2 - 11, 'JOGAR', {
            fontSize: '13px',
            fontFamily: 'Arial Black, Arial',
            fontWeight: 'bold',
            fill: '#ffffff'
        }).setOrigin(0.5);

        // Hover highlight overlay
        const hoverOverlay = this.add.graphics();
        hoverOverlay.fillStyle(0xffffff, 0.08);
        hoverOverlay.fillRoundedRect(-w/2, -h/2, w, h, 22);
        hoverOverlay.setAlpha(0);

        container.add([shadow, card, pawn, label, btnBg, btnLabel, hoverOverlay]);

        // Interaction
        const hitArea = new Phaser.Geom.Rectangle(-w/2, -h/2, w, h);
        container.setInteractive(hitArea, Phaser.Geom.Rectangle.Contains, { useHandCursor: true });

        // Idle bob animation
        this.tweens.add({
            targets: pawn,
            y: pawn.y - 8,
            duration: 1000 + Math.random() * 400,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut'
        });

        container.on('pointerover', () => {
            this.tweens.add({ targets: hoverOverlay, alpha: 1, duration: 200 });
            this.tweens.add({ targets: container, scaleX: 1.04, scaleY: 1.04, duration: 150, ease: 'Back.easeOut' });
        });

        container.on('pointerout', () => {
            this.tweens.add({ targets: hoverOverlay, alpha: 0, duration: 200 });
            this.tweens.add({ targets: container, scaleX: 1, scaleY: 1, duration: 150 });
        });

        container.on('pointerdown', () => {
            // Quick pulse animation on click
            this.tweens.add({
                targets: container,
                scaleX: 0.95, scaleY: 0.95,
                duration: 80,
                yoyo: true,
                onComplete: () => {
                    this.scene.start('GameScene', {
                        mode: this.mode,
                        playerColor: cd.key
                    });
                }
            });
        });
    }

    drawPawn(color, darkColor) {
        const g = this.add.graphics();
        const y = -10;

        // Shadow
        g.fillStyle(0x000000, 0.25);
        g.fillEllipse(0, y + 46, 44, 16);

        // Body
        g.fillStyle(color, 1);
        g.lineStyle(2.5, darkColor, 1);

        // Base ellipse
        g.fillEllipse(0, y + 36, 44, 18);
        g.strokeEllipse(0, y + 36, 44, 18);

        // Torso trapezoid
        g.beginPath();
        g.moveTo(-20, y + 36);
        g.lineTo(-10, y + 4);
        g.lineTo(10, y + 4);
        g.lineTo(20, y + 36);
        g.closePath();
        g.fillPath();
        g.strokePath();

        // Head
        g.fillCircle(0, y - 4, 18);
        g.strokeCircle(0, y - 4, 18);

        // Shine on head
        g.fillStyle(0xffffff, 0.4);
        g.fillCircle(-6, y - 10, 6);
        g.fillStyle(0xffffff, 0.2);
        g.fillCircle(-4, y - 7, 10);

        return g;
    }
}

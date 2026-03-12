import Phaser from 'phaser';

export class MenuScene extends Phaser.Scene {
    constructor() {
        super('MenuScene');
    }

    preload() {
        this.load.image('menu_bg', '/menu_bg.png');
        this.load.image('lobby_bg_cartoon', '/lobby_bg_cartoon.png');
        this.load.image('game_bg', '/game_bg.png');
        this.load.image('color_pick_bg', '/color_pick_bg.png');
    }

    create() {
        const W = this.cameras.main.width;
        const H = this.cameras.main.height;
        const cx = W / 2;
        const cy = H / 2;
        
        // Background
        const bg = this.add.image(cx, cy, 'menu_bg');
        const scaleX = W / bg.width;
        const scaleY = H / bg.height;
        bg.setScale(Math.max(scaleX, scaleY) || 1);

        // Dark overlay for readability
        this.add.rectangle(0, 0, W, H, 0x000000, 0.45).setOrigin(0);

        // Title
        this.add.text(cx, H * 0.18, 'LUDO ONLINE', {
            fontSize: '54px',
            fontFamily: 'Arial',
            fontWeight: 'bold',
            fill: '#ffffff',
            shadow: { offsetX: 3, offsetY: 3, color: '#000', blur: 5, fill: true }
        }).setOrigin(0.5);

        this.add.text(cx, H * 0.28, 'Escolha o Modo de Jogo', {
            fontSize: '24px',
            fill: '#888888'
        }).setOrigin(0.5);

        // Buttons
        // Button 1 (IA): Green
        this.createButton(cx, H * 0.43, 'Jogar contra I.A.', 'color_pick_bg', 0x00ee00, () => {
            this.scene.start('ColorPickScene', { mode: 'IA' });
        });

        // Button 2 (Online): Red
        this.createButton(cx, H * 0.63, 'Multiplayer Online', 'lobby_bg_cartoon', 0xff3333, () => {
            this.scene.start('LobbyScene');
        });

        // Button 3 (Local): Yellow
        this.createButton(cx, H * 0.83, 'Multiplayer Local', 'game_bg', 0xffd700, () => {
            this.scene.start('ColorPickScene', { mode: 'LOCAL' });
        });
    }

    createButton(x, y, text, previewKey, themeColor, onClick) {
        const btn = this.add.container(x, y);
        const w = 420, h = 120;
        
        // 1. Shadow (Colored glow)
        const shadow = this.add.graphics();
        shadow.fillStyle(themeColor, 0.2);
        shadow.fillRoundedRect(-w/2 + 5, -h/2 + 8, w, h, 20); 
        
        // 2. Black Translucent Background (70%)
        const bg = this.add.graphics();
        bg.fillStyle(0x000000, 0.7);
        bg.fillRoundedRect(-w/2, -h/2, w, h, 20);
        
        // Themed Border
        bg.lineStyle(3, themeColor, 0.9);
        bg.strokeRoundedRect(-w/2, -h/2, w, h, 20);

        // 3. Preview Image (small thumbnail inside)
        const maskGraphics = this.make.graphics({ x, y, add: false });
        maskGraphics.fillRoundedRect(-w/2 + 10, -h/2 + 10, 100, 100, 15);
        const mask = maskGraphics.createGeometryMask();

        const preview = this.add.image(-w/2 + 60, 0, previewKey);
        const pScale = Math.max(100 / preview.width, 100 / preview.height);
        preview.setScale(pScale).setMask(mask);
        
        // Border for the preview thumbnail in theme color
        const thumbBorder = this.add.graphics();
        thumbBorder.lineStyle(3, themeColor, 0.6);
        thumbBorder.strokeRoundedRect(-w/2 + 10, -h/2 + 10, 100, 100, 15);

        // 4. Hover effect overlay (Colored)
        const hoverOverlay = this.add.graphics();
        hoverOverlay.fillStyle(themeColor, 0.15);
        hoverOverlay.fillRoundedRect(-w/2, -h/2, w, h, 20);
        hoverOverlay.setAlpha(0);
        
        // 5. Text (White with theme shadow)
        const txt = this.add.text(60, 0, text, {
            fontSize: '26px',
            fontFamily: 'Arial Black',
            fill: '#ffffff',
            fontWeight: 'bold',
            stroke: '#000000',
            strokeThickness: 3,
            shadow: { offsetX: 0, offsetY: 0, color: '#' + themeColor.toString(16).padStart(6, '0'), blur: 10, fill: true }
        }).setOrigin(0.5);

        btn.add([shadow, bg, preview, thumbBorder, hoverOverlay, txt]);
        
        const hitArea = new Phaser.Geom.Rectangle(-w/2, -h/2, w, h);
        btn.setInteractive(hitArea, Phaser.Geom.Rectangle.Contains, { useHandCursor: true });
        
        btn.on('pointerdown', () => btn.setScale(0.96));
        btn.on('pointerup', () => { btn.setScale(1); onClick(); });
        btn.on('pointerover', () => {
            this.tweens.add({ targets: hoverOverlay, alpha: 1, duration: 200 });
            this.tweens.add({ targets: btn, scale: 1.03, duration: 150, ease: 'Back.easeOut' });
        });
        btn.on('pointerout', () => {
            btn.setScale(1);
            this.tweens.add({ targets: hoverOverlay, alpha: 0, duration: 200 });
        });
    }
}

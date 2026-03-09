import Phaser from 'phaser';

export class MenuScene extends Phaser.Scene {
    constructor() {
        super('MenuScene');
    }

    preload() {
        this.load.image('menu_bg', '/menu_bg.png');
    }

    create() {
        const cx = this.cameras.main.centerX;
        
        // Background
        const bg = this.add.image(cx, this.cameras.main.centerY, 'menu_bg');
        const scaleX = 640 / bg.width;
        const scaleY = 780 / bg.height;
        bg.setScale(Math.max(scaleX, scaleY) || 1); // Fallback to 1 if image is not fully loaded immediately

        // Dark overlay for readability
        this.add.rectangle(0, 0, 640, 780, 0x000000, 0.45).setOrigin(0);

        // Title
        this.add.text(cx, 150, 'LUDO ONLINE', {
            fontSize: '54px',
            fontFamily: 'Arial',
            fontWeight: 'bold',
            fill: '#ffffff',
            shadow: { offsetX: 3, offsetY: 3, color: '#000', blur: 5, fill: true }
        }).setOrigin(0.5);

        this.add.text(cx, 220, 'Escolha o Modo de Jogo', {
            fontSize: '24px',
            fill: '#888888'
        }).setOrigin(0.5);

        // Buttons
        this.createButton(cx, 350, 'Jogar contra I.A.', '#4CAF50', () => {
            this.scene.start('GameScene', { mode: 'IA' });
        });

        this.createButton(cx, 450, 'Multiplayer Online', '#2196F3', () => {
            // alert('Em breve integração com Supabase!');
            this.scene.start('GameScene', { mode: 'MULTIPLAYER' });
        });

        this.createButton(cx, 550, 'Multiplayer Local', '#FF9800', () => {
            this.scene.start('GameScene', { mode: 'LOCAL' });
        });
    }

    createButton(x, y, text, color, onClick) {
        const btn = this.add.container(x, y);
        
        // 1. Drop shadow
        const shadow = this.add.graphics();
        shadow.fillStyle(0x000000, 0.5);
        shadow.fillRoundedRect(-145, -25, 300, 60, 30); 
        
        // 2. Base colored shape
        const bg = this.add.graphics();
        bg.fillStyle(parseInt(color.replace('#', '0x')), 1);
        bg.fillRoundedRect(-150, -30, 300, 60, 30); // Fully rounded pill
        // Elegant semi-transparent border
        bg.lineStyle(2, 0xffffff, 0.3);
        bg.strokeRoundedRect(-150, -30, 300, 60, 30);

        // 3. Top Sheen overlay (glassmorphism feel)
        const sheen = this.add.graphics();
        sheen.fillStyle(0xffffff, 0.15);
        // Half-height rectangle for the glossy reflection effect on top half
        sheen.fillRoundedRect(-148, -28, 296, 28, { tl: 28, tr: 28, bl: 0, br: 0 });

        // 4. Hover effect overlay
        const hoverOverlay = this.add.graphics();
        hoverOverlay.fillStyle(0xffffff, 0.25);
        hoverOverlay.fillRoundedRect(-150, -30, 300, 60, 30);
        hoverOverlay.setAlpha(0); // Invisible by default
        
        // 5. Text with shadow for max legibility
        const txt = this.add.text(0, 0, text, {
            fontSize: '24px',
            fontFamily: 'Arial',
            fill: '#ffffff',
            fontWeight: 'bold',
            shadow: { offsetX: 1, offsetY: 2, color: '#000000', blur: 3, fill: true, opacity: 0.6 }
        }).setOrigin(0.5);

        btn.add([shadow, bg, sheen, hoverOverlay, txt]);
        
        const hitArea = new Phaser.Geom.Rectangle(-150, -30, 300, 60);
        btn.setInteractive(hitArea, Phaser.Geom.Rectangle.Contains, { useHandCursor: true });
        
        btn.on('pointerdown', () => {
            btn.setScale(0.96);
        });

        btn.on('pointerup', () => {
            btn.setScale(1);
            onClick();
        });

        btn.on('pointerover', () => {
            this.tweens.add({ targets: hoverOverlay, alpha: 1, duration: 250, ease: 'Sine.easeOut' });
        });

        btn.on('pointerout', () => {
            btn.setScale(1);
            this.tweens.add({ targets: hoverOverlay, alpha: 0, duration: 250, ease: 'Sine.easeOut' });
        });
    }
}

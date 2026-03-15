import Phaser from 'phaser';
import { COLORS, DARK_COLORS, BOARD_CONFIG } from '../constants';
import { LudoLogic } from '../logic/LudoLogic';
import { getCoordinates } from '../logic/PathMapping';
import { LudoAI } from '../logic/LudoAI';
import { LudoOnline } from '../logic/LudoOnline';

export class GameScene extends Phaser.Scene {
    constructor() {
        super('GameScene');
    }

    init(data) {
        this.mode = data?.mode || 'IA';
        this.playerColor = data?.playerColor || 'RED';
        this.activePlayers = data?.activePlayers;
        this.roomId = data?.roomId;
        this.turnDuration = 7000; // 7 seconds
        
        // Safety fallback if data is missing or corrupted
        if (!Array.isArray(this.activePlayers) || this.activePlayers.length === 0) {
            this.activePlayers = ['RED', 'BLUE', 'YELLOW', 'GREEN'];
        }
    }

    preload() {
        this.load.image('game_bg', '/game_bg.png');
    }

    create() {
        const W = this.cameras.main.width;
        const H = this.cameras.main.height;
        const cx = W / 2;
        const cy = H / 2;
        
        // Background
        const bg = this.add.image(cx, cy, 'game_bg').setDepth(-2);
        const scaleX = W / bg.width;
        const scaleY = H / bg.height;
        bg.setScale(Math.max(scaleX, scaleY) || 1);
        
        // Dark overlay so the main playing board stands out clearly
        this.add.rectangle(0, 0, W, H, 0x000000, 0.3).setOrigin(0).setDepth(-1);

        // Validar activePlayers
        const validColors = ['RED', 'BLUE', 'YELLOW', 'GREEN'];
        if (!Array.isArray(this.activePlayers)) this.activePlayers = validColors;
        this.activePlayers = this.activePlayers.filter(c => validColors.includes(c));
        if (this.activePlayers.length === 0) this.activePlayers = validColors;

        this.logic = new LudoLogic(this.activePlayers);
        this.ai = new LudoAI(this.logic);
        
        if (this.mode === 'IA') {
            // AI plays all colors except the one the human chose
            this.aiPlayers = this.activePlayers.filter(c => c !== this.playerColor);
        } else {
            this.aiPlayers = [];
        }

        const baseBoardSize = 15 * BOARD_CONFIG.CELL_SIZE; // 600px
        
        // Calculate dynamic scale: allow 92% of screen width on small devices
        this.mainScale = Math.min(1, (W * 0.92) / baseBoardSize);
        this.pieceScale = this.mainScale * 1.17; // 10% reduction from 1.3
        // Also ensure it fits vertically
        if (H < baseBoardSize + 150) {
            this.mainScale = Math.min(this.mainScale, (H * 0.7) / baseBoardSize);
        }

        const scaledBoardSize = baseBoardSize * this.mainScale;
        this.boardX = (W - scaledBoardSize) / 2;
        this.boardY = (H - scaledBoardSize) / 2 - (20 * this.mainScale);
        this.diceY = this.boardY + scaledBoardSize + (50 * this.mainScale);

        this.drawBoard();
        this.createDiceUI();
        this.createPieces();
        this.updateStatusText();
        
        // Let's add an Exit Button
        const exitBtn = this.add.text(20, 20, '← Sair', {
            fontSize: '18px',
            fontFamily: 'Arial',
            fill: '#ffffff',
            backgroundColor: '#ff3333',
            padding: { x: 10, y: 5 }
        })
        .setInteractive({ useHandCursor: true })
        .setDepth(100) // Ensure it's above board elements
        .on('pointerdown', () => {
            if (this.online) this.online.leaveRoom(this.playerColor);
            this.scene.start('MenuScene');
        });

        // Create particle texture for victory
        if (!this.textures.exists('particle_dot')) {
            const dot = this.make.graphics({ x: 0, y: 0, add: false });
            dot.fillStyle(0xffffff, 1);
            dot.fillCircle(4, 4, 4);
            dot.generateTexture('particle_dot', 8, 8);
        }

        if (this.mode === 'ONLINE' && this.roomId) {
            this.online = new LudoOnline(this.roomId, (state) => this.onOnlineUpdate(state));
            this.online.joinRoom(this.playerColor);
            
            // SECURITY FALLBACK: Sync with server every 3 seconds in case Realtime fails
            this.syncTimer = this.time.addEvent({
                delay: 3000,
                callback: () => this.online.syncWithServer(),
                loop: true
            });
        } else {
            this.checkAITurn();
        }

        this.startTurnTimer();
    }

    startTurnTimer() {
        if (this.turnTimer) this.turnTimer.remove();
        this.timeLeft = 7;
        
        const turnColor = this.logic.turn;
        const isAI = this.aiPlayers.includes(turnColor);
        // Only show if it's a local human or it's my turn online
        const isMyAction = !isAI && (this.mode !== 'ONLINE' || turnColor === this.playerColor);

        if (this.timerLabel) {
            this.timerLabel.setText('7');
            this.timerLabel.setVisible(isMyAction);
            this.timerLabel.setScale(this.mainScale);
        }

        this.turnTimer = this.time.addEvent({
            delay: 1000,
            repeat: 6,
            callback: () => {
                this.timeLeft--;
                this.updateStatusText();
                if (this.timerLabel.visible) {
                    this.timerLabel.setScale(this.mainScale * 1.3);
                    this.tweens.add({
                        targets: this.timerLabel,
                        scale: this.mainScale,
                        duration: 300,
                        ease: 'Back.easeOut'
                    });
                }
                if (this.timeLeft <= 0) {
                    console.log(`[Timer] Timeout for ${this.logic.turn}`);
                    this.handleTimeout();
                }
            }
        });
    }

    handleTimeout() {
        // Only trigger timeout if it's a human turn (Local or my turn Online)
        if (this.mode === 'ONLINE' && this.logic.turn !== this.playerColor) return;
        if (this.aiPlayers.includes(this.logic.turn)) return;

        this.showTemporaryMessage(this.logic.turn, 'Tempo Esgotado!\nIA assumindo...');
        this.clearHighlights();
        
        // Let the AI take over this specific turn
        this.time.delayedCall(1000, () => {
            if (this.logic.gameState === 'WAITING_FOR_ROLL') {
                const value = this.logic.rollDice();
                if (value) {
                    if (this.mode === 'ONLINE') {
                        this.online.updateGame(this.logic.turn, value, this.logic.pieces);
                    }
                    this.processRoll(value, true);
                }
            } else if (this.logic.gameState === 'WAITING_FOR_MOVE') {
                this.handleAIMove();
            }
        });
    }

    goToNextTurn() {
        // 1 second delay between turns
        this.time.delayedCall(1000, () => {
            this.logic.nextTurn();
            
            if (this.mode === 'ONLINE') {
                this.online.updateGame(this.logic.turn, 0, this.logic.pieces);
            }
            
            this.updateStatusText();
            this.startTurnTimer();
            this.checkAITurn();
        });
    }

    onOnlineUpdate(state) {
        if (!state) return;
        
        const isMyTurn = (this.mode !== 'ONLINE' || state.current_turn === this.playerColor);
        const isDifferentTurn = state.current_turn !== this.logic.turn;
        const isDifferentDice = state.last_dice_roll !== this.logic.diceRoll;
        
        // Find which piece moved
        let movedPiece = null;
        for (const color of ['RED', 'BLUE', 'YELLOW', 'GREEN']) {
            for (let i = 0; i < 4; i++) {
                if (state.pieces[color][i] !== this.logic.pieces[color][i]) {
                    movedPiece = { color, index: i, oldPos: this.logic.pieces[color][i], newPos: state.pieces[color][i] };
                    break;
                }
            }
            if (movedPiece) break;
        }

        const isDifferentPieces = !!movedPiece;

        if (isDifferentTurn || isDifferentDice || isDifferentPieces) {
            console.log(`[REALTIME] Syncing... Turn=${state.current_turn}, Dice=${state.last_dice_roll}`);
            
            // 1. Handle Dice Animation
            if (isDifferentDice && state.last_dice_roll > 0 && !isMyTurn) {
                this.animateDice(state.last_dice_roll);
            }

            // 2. Handle Piece Movement Animation
            if (isDifferentPieces) {
                if (!isMyTurn) {
                    // Someone else moved: Animate it for fluidity
                    this.logic.diceRoll = state.last_dice_roll; // Ensure logic has the roll needed for calc
                    this.animatePath(movedPiece.color, movedPiece.index, movedPiece.oldPos, movedPiece.newPos, () => {
                        this.finishOnlineSync(state);
                    });
                } else {
                    // It was our move: we already animated, just update logic
                    this.finishOnlineSync(state);
                }
            } else {
                this.finishOnlineSync(state);
            }
        }
    }

    finishOnlineSync(state) {
        this.logic.turn = state.current_turn;
        this.logic.diceRoll = state.last_dice_roll;
        this.logic.pieces = state.pieces;
        this.logic.gameState = (state.last_dice_roll === 0) ? 'WAITING_FOR_ROLL' : 'WAITING_FOR_MOVE';
        
        this.updateAllPiecePositions(true);
        if (this.logic.gameState === 'WAITING_FOR_ROLL') this.resetDice();
        
        this.updateStatusText();
        this.startTurnTimer();
        this.checkAITurn(); 
    }

    drawBoard() {
        const { CELL_SIZE } = BOARD_CONFIG;
        const graphics = this.add.graphics().setDepth(0);
        graphics.setPosition(this.boardX, this.boardY);
        graphics.setScale(this.mainScale);

        // Board Shadow
        graphics.fillStyle(0x000000, 0.4);
        graphics.fillRoundedRect(-8, -8, 15 * CELL_SIZE + 16, 15 * CELL_SIZE + 16, 20);

        // Dark Solid Base for the board (to make it readable even with transparency)
        graphics.fillStyle(0x222222, 0.5);
        graphics.fillRoundedRect(0, 0, 15 * CELL_SIZE, 15 * CELL_SIZE, 15);

        // Base Board fill (White background) - Added transparency
        graphics.fillStyle(0xffffff, 0.5);
        graphics.fillRoundedRect(0, 0, 15 * CELL_SIZE, 15 * CELL_SIZE, 15);

        for (let x = 0; x < 15; x++) {
            for (let y = 0; y < 15; y++) {
                const isVerticalPath = (x >= 6 && x <= 8);
                const isHorizontalPath = (y >= 6 && y <= 8);
                if (!isVerticalPath && !isHorizontalPath) continue;
                if (x >= 6 && x <= 8 && y >= 6 && y <= 8) continue; // center

                let fillCol = 0xffffff; // default white path
                let isHomePath = false;
                let homeColor = null;

                // Safe spots (5 houses before each exit)
                const isSafe = (x === 8 && y === 12) || (x === 2 && y === 8) || (x === 6 && y === 2) || (x === 12 && y === 6);
                if (isSafe) fillCol = 0xb0b0b0; // Medium gray

                if (x === 7 && y >= 9 && y <= 13) { fillCol = DARK_COLORS.RED; isHomePath = true; homeColor = "RED"; }
                else if (y === 7 && x >= 1 && x <= 5) { fillCol = DARK_COLORS.BLUE; isHomePath = true; homeColor = "BLUE"; }
                else if (x === 7 && y >= 1 && y <= 5) { fillCol = DARK_COLORS.YELLOW; isHomePath = true; homeColor = "YELLOW"; }
                else if (y === 7 && x >= 9 && x <= 13) { fillCol = DARK_COLORS.GREEN; isHomePath = true; homeColor = "GREEN"; }
                
                const cx = x * CELL_SIZE + 2;
                const cy = y * CELL_SIZE + 2;
                const cw = CELL_SIZE - 4;

                // Cell base
                graphics.fillStyle(fillCol, 1);
                graphics.fillRoundedRect(cx, cy, cw, cw, 8);
                
                // Border light - Darker for white cells
                const borderAlpha = fillCol === 0xffffff ? 0.6 : 0.4;
                const borderCol = fillCol === 0xffffff ? 0x000000 : 0x222222;
                graphics.lineStyle(1, borderCol, borderAlpha); 
                graphics.strokeRoundedRect(cx, cy, cw, cw, 6);

                // Arrows for entry
                if (x === 7 && y === 14) this.drawArrow(graphics, cx + cw/2, cy + cw/2, 'UP', COLORS.RED);
                else if (x === 0 && y === 7) this.drawArrow(graphics, cx + cw/2, cy + cw/2, 'RIGHT', COLORS.BLUE);
                else if (x === 7 && y === 0) this.drawArrow(graphics, cx + cw/2, cy + cw/2, 'DOWN', COLORS.YELLOW);
                else if (x === 14 && y === 7) this.drawArrow(graphics, cx + cw/2, cy + cw/2, 'LEFT', COLORS.GREEN);

                // Safe paths or star points
                if (x === 6 && y === 13) this.drawNeonCell(graphics, cx, cy, cw, COLORS.RED);
                else if (x === 1 && y === 6) this.drawNeonCell(graphics, cx, cy, cw, COLORS.BLUE);
                else if (x === 8 && y === 1) this.drawNeonCell(graphics, cx, cy, cw, COLORS.YELLOW);
                else if (x === 13 && y === 8) this.drawNeonCell(graphics, cx, cy, cw, COLORS.GREEN);
                
                // Home paths neon trails
                if (isHomePath) {
                    const c = COLORS[homeColor];
                    // Outer glow
                    graphics.lineStyle(2, c, 0.6);
                    graphics.strokeRoundedRect(cx + 4, cy + 4, cw - 8, cw - 8, 4);
                }
            }
        }

        this.drawBase(graphics, 0, 0, COLORS.BLUE, 'BLUE');
        this.drawBase(graphics, 9 * CELL_SIZE, 0, COLORS.YELLOW, 'YELLOW');
        this.drawBase(graphics, 0, 9 * CELL_SIZE, COLORS.RED, 'RED');
        this.drawBase(graphics, 9 * CELL_SIZE, 9 * CELL_SIZE, COLORS.GREEN, 'GREEN');

        // Complex Starburst Central Area
        this.drawCentralStarburst(graphics);
    }

    drawArrow(g, x, y, direction, color) {
        g.fillStyle(color, 1);
        g.lineStyle(1, 0xffffff, 1);
        const s = 10;
        const pts = [];
        if (direction === 'UP') pts.push({x:x,y:y-s},{x:x+s,y:y+s},{x:x,y:y+s/2},{x:x-s,y:y+s});
        else if (direction === 'DOWN') pts.push({x:x,y:y+s},{x:x+s,y:y-s},{x:x,y:y-s/2},{x:x-s,y:y-s});
        else if (direction === 'LEFT') pts.push({x:x-s,y:y},{x:x+s,y:y+s},{x:x+s/2,y:y},{x:x+s,y:y-s});
        else pts.push({x:x+s,y:y},{x:x-s,y:y+s},{x:x-s/2,y:y},{x:x-s,y:y-s});
        
        g.beginPath();
        g.moveTo(pts[0].x, pts[0].y);
        for(let i=1;i<pts.length;i++) g.lineTo(pts[i].x, pts[i].y);
        g.closePath();
        g.fillPath();
        g.strokePath();
    }

    drawNeonCell(graphics, x, y, size, color) {
        graphics.lineStyle(3, color, 1);
        graphics.strokeRoundedRect(x, y, size, size, 8);
        graphics.fillStyle(color, 0.2);
        graphics.fillRoundedRect(x, y, size, size, 8);
    }

    drawCentralStarburst(graphics) {
        const { CELL_SIZE } = BOARD_CONFIG;
        const cx = 7.5 * CELL_SIZE;
        const cy = 7.5 * CELL_SIZE;
        const size = 3 * CELL_SIZE;
        const startX = 6 * CELL_SIZE;
        const startY = 6 * CELL_SIZE;

        // Dark background for central finishing area
        graphics.fillStyle(0x000000, 0.75);
        graphics.fillRect(startX, startY, size, size);

        // Draw colored triangles without white lines
        const drawShard = (c, p1x, p1y, p2x, p2y) => {
            graphics.fillStyle(c, 0.4);
            graphics.fillTriangle(p1x, p1y, p2x, p2y, cx, cy);
            graphics.lineStyle(2, c, 1);
            graphics.strokeTriangle(p1x, p1y, p2x, p2y, cx, cy);
        };

        drawShard(COLORS.BLUE, startX, startY, startX, startY + size);
        drawShard(COLORS.YELLOW, startX, startY, startX + size, startY);
        drawShard(COLORS.GREEN, startX + size, startY, startX + size, startY + size);
        drawShard(COLORS.RED, startX, startY + size, startX + size, startY + size);
    }

    drawBase(graphics, x, y, color, colorName) {
        const isActive = this.activePlayers.includes(colorName);
        const baseAlpha = isActive ? 1 : 0.25;
        const size = 6 * BOARD_CONFIG.CELL_SIZE;
        const baseCx = x + size / 2;
        const baseCy = y + size / 2;

        // Neon Vibrant Frame (Border)
        graphics.lineStyle(6, color, 0.3 * baseAlpha);
        graphics.strokeRoundedRect(x + 4, y + 4, size - 8, size - 8, 20);
        graphics.lineStyle(3, color, baseAlpha);
        graphics.strokeRoundedRect(x + 4, y + 4, size - 8, size - 8, 20);
        graphics.lineStyle(1.5, 0xffffff, 0.8 * baseAlpha);
        graphics.strokeRoundedRect(x + 6, y + 6, size - 12, size - 12, 18);

        // Main colored area (Colored like the start squares)
        graphics.fillStyle(color, 0.15 * baseAlpha);
        graphics.fillRoundedRect(x + 10, y + 10, size - 20, size - 20, 16);

        // Internal moldura (dark player color) - Much thicker to fill the gap
        graphics.lineStyle(18, DARK_COLORS[colorName], baseAlpha);
        graphics.strokeRoundedRect(x + 16, y + 16, size - 32, size - 32, 14);

        // Light Shine (Glossy effect)
        graphics.lineStyle(2, 0xffffff, 0.25 * baseAlpha);
        graphics.strokeRoundedRect(x + 12, y + 12, size - 24, size - 24, 16);

        // Internal Shadow (Depth effect)
        graphics.lineStyle(2, 0x000000, 0.4 * baseAlpha);
        graphics.strokeRoundedRect(x + 22, y + 22, size - 44, size - 44, 12);

        // Extra internal hint of color (Lighter area inside the dark frame)
        graphics.fillStyle(color, 0.2 * baseAlpha);
        graphics.fillRoundedRect(x + 20, y + 20, size - 40, size - 40, 12);

        // Spots area highlight (clear vibrant neon)
        graphics.lineStyle(2, color, 0.8 * baseAlpha);
        graphics.strokeRoundedRect(x + 30, y + 30, size - 60, size - 60, 10);

        const offset = BOARD_CONFIG.CELL_SIZE; // Exactly 1 cell away from center (40px)
        const spots = [
            {cx: baseCx - offset, cy: baseCy - offset},
            {cx: baseCx + offset, cy: baseCy - offset},
            {cx: baseCx - offset, cy: baseCy + offset},
            {cx: baseCx + offset, cy: baseCy + offset}
        ];
        
        spots.forEach(spot => {
            // Dark filled circle in player's color
            graphics.fillStyle(DARK_COLORS[colorName], baseAlpha);
            graphics.fillCircle(spot.cx, spot.cy, 15); // +15% from 13
            
            // Neon accent border
            graphics.lineStyle(2, color, baseAlpha);
            graphics.strokeCircle(spot.cx, spot.cy, 15);
            graphics.lineStyle(1, 0xffffff, 0.5 * baseAlpha);
            graphics.strokeCircle(spot.cx, spot.cy, 13); // +15% from 11
        });
    }


    createDiceUI() {
        const boardSize = 600 * this.mainScale;
        const vPad = 55 * this.mainScale; // Vertical padding (outside top/bottom)
        const hOffset = 38 * this.mainScale; // Horizontal offset from board edge
        
        // Positions aligned with board horizontal limits
        this.dicePositions = {
            RED:    { x: this.boardX + hOffset,             y: this.boardY + boardSize + vPad },
            BLUE:   { x: this.boardX + hOffset,             y: this.boardY - vPad },
            YELLOW: { x: this.boardX + boardSize - hOffset, y: this.boardY - vPad },
            GREEN:  { x: this.boardX + boardSize - hOffset, y: this.boardY + boardSize + vPad }
        };

        // UI Label Offsets (relative to Dice Center)
        this.timerOffsets = {
            RED:    { x: 50 * this.mainScale,  y: 0, align: 'left' },
            BLUE:   { x: 50 * this.mainScale,  y: 0, align: 'left' },
            YELLOW: { x: -50 * this.mainScale, y: 0, align: 'right' },
            GREEN:  { x: -50 * this.mainScale, y: 0, align: 'right' }
        };

        this.diceUI = {};

        ['RED', 'BLUE', 'YELLOW', 'GREEN'].forEach(color => {
            const pos = this.dicePositions[color];
            const container = this.add.container(pos.x, pos.y).setDepth(20);
            container.setScale(this.mainScale);
            
            // Dice Shadow
            const shadow = this.add.ellipse(0, 25, 50, 15, 0x000000, 0.3);
            
            // White Dice Body (Ensuring pure white)
            const diceBg = this.add.graphics();
            diceBg.fillStyle(0xffffff, 1);
            diceBg.fillRoundedRect(-30, -30, 60, 60, 12);
            diceBg.lineStyle(2, 0xdddddd, 1); 
            diceBg.strokeRoundedRect(-30, -30, 60, 60, 12);
            
            // Inner depth
            diceBg.fillStyle(0xeeeeee, 1);
            diceBg.fillRoundedRect(22, -24, 6, 50, 4);
            diceBg.fillRoundedRect(-24, 22, 50, 6, 4);

            const diceText = this.add.text(0, 0, 'GIRAR', { 
                fontSize: '12px', fill: '#888', fontWeight: 'bold' 
            }).setOrigin(0.5);

            // Dice border highlight (Removed padding)
            const highlight = this.add.graphics();
            highlight.lineStyle(6, COLORS[color], 1); 
            highlight.strokeRoundedRect(-30, -30, 60, 60, 12);
            
            // Add a subtle bloom effect (Glow) - Now behind the dice
            const glow = this.add.graphics();
            glow.fillStyle(COLORS[color], 0.3);
            glow.fillRoundedRect(-33, -33, 66, 66, 14);
            glow.setName('glow');
            glow.setVisible(false);
            
            highlight.setVisible(false);
            highlight.setName('highlight');

            const face = this.add.graphics();
            
            // Moved glow to before diceBg so it doesn't tint the white body
            container.add([shadow, glow, diceBg, highlight, diceText, face]);
            
            const hitArea = new Phaser.Geom.Rectangle(-30, -30, 60, 60);
            container.setInteractive(hitArea, Phaser.Geom.Rectangle.Contains, { useHandCursor: true });
            
            container.on('pointerdown', () => this.handleRoll());

            this.diceUI[color] = { container, diceText, face, highlight, shadow };
        });

        // Board Border Graphic
        this.boardBorder = this.add.graphics().setDepth(5);
        this.boardBorder.setPosition(this.boardX, this.boardY);

        // UI Container for Timer + Status
        this.statusContainer = this.add.container(0, 0).setDepth(100);

        this.statusTextLabel = this.add.text(0, 0, 'GIRAR', {
            fontSize: `${18 * this.mainScale}px`,
            fontFamily: 'Arial Black',
            fill: '#ffffff',
            stroke: '#000',
            strokeThickness: 3
        }).setOrigin(0.5);

        this.timerLabel = this.add.text(0, 0, '07', {
            fontSize: `${36 * this.mainScale}px`,
            fontFamily: 'Arial Black',
            fill: '#ffffff',
            stroke: '#000000',
            strokeThickness: 5
        }).setOrigin(0.5);

        this.statusContainer.add([this.statusTextLabel, this.timerLabel]);
        this.statusContainer.setVisible(false);
    }

    resetDice() {
        ['RED', 'BLUE', 'YELLOW', 'GREEN'].forEach(color => {
            const ui = this.diceUI[color];
            ui.diceText.setText('GIRAR').setVisible(true);
            ui.face.clear();
            ui.container.angle = 0;
            ui.container.setScale(this.mainScale);
            ui.shadow.setScale(1);
            ui.shadow.setAlpha(0.3);
            ui.highlight.setVisible(false);
            this.tweens.killTweensOf(ui.highlight);
        });
    }

    drawDiceFace(value, color = null) {
        const turnColor = color || this.logic.turn;
        const ui = this.diceUI[turnColor];
        
        ui.face.clear();
        ui.diceText.setVisible(value === 0);
        
        if (value === 0) return;
        
        ui.face.fillStyle(0x222222, 1);
        const positions = [];
        
        if (value === 1 || value === 3 || value === 5) positions.push({x:0, y:0});
        if (value > 1) { positions.push({x:-14, y:-14}); positions.push({x:14, y:14}); }
        if (value > 3) { positions.push({x:14, y:-14}); positions.push({x:-14, y:14}); }
        if (value === 6) { positions.push({x:-14, y:0}); positions.push({x:14, y:0}); }
        
        positions.forEach(p => ui.face.fillCircle(p.x, p.y, 6));
    }

    handleRoll() {
        if (this.mode === 'ONLINE') {
            if (this.logic.turn !== this.playerColor || this.logic.gameState !== 'WAITING_FOR_ROLL') return;
        } else if (this.aiPlayers.includes(this.logic.turn) || this.logic.gameState !== 'WAITING_FOR_ROLL') {
            return;
        }

        const value = this.logic.rollDice();
        if (value) {
            if (this.mode === 'ONLINE') {
                this.online.updateGame(this.logic.turn, value, this.logic.pieces);
            }
            this.processRoll(value);
        }
    }

    processRoll(value, forceAI = false) {
        this.updateStatusText();
        this.animateDice(value);
        
        // Match the faster dice animation (600ms stop + 50ms buffer)
        this.time.delayedCall(650, () => {
            if (this.logic.consecutiveSixes >= 3) {
                this.showTemporaryMessage(this.logic.turn, 'Perdeu a vez\n(3 seis)!');
                this.time.delayedCall(1500, () => {
                    this.clearHighlights();
                    this.resetDice();
                    this.goToNextTurn();
                });
                return;
            }

            if (!this.logic.canAnyPieceMove()) {
                this.showTemporaryMessage(this.logic.turn, 'Sem\njogadas!');
                this.time.delayedCall(1500, () => {
                    this.clearHighlights();
                    this.resetDice();
                    this.goToNextTurn();
                });
                return;
            }

            if (forceAI || this.aiPlayers.includes(this.logic.turn)) {
                this.time.delayedCall(600, () => this.handleAIMove());
            } else {
                this.highlightPossibleMoves();
            }
        });
    }

    animateDice(value) {
        const color = this.logic.turn;
        const ui = this.diceUI[color];
        
        ui.diceText.setVisible(false);
        ui.face.clear();

        // 1. Subtle jump and single spin
        this.tweens.add({
            targets: ui.container,
            y: this.dicePositions[color].y - (15 * this.mainScale), 
            scaleX: this.mainScale * 1.1, // Increased scale for more vibrancy
            scaleY: this.mainScale * 1.1, // Increased scale for more vibrancy
            angle: 360, 
            duration: 225, // 25% Faster
            yoyo: true,
            ease: 'Sine.easeOut'
        });

        // 2. Shrink shadow
        this.tweens.add({
            targets: ui.shadow,
            scaleX: 0.6,
            scaleY: 0.6,
            alpha: 0.1,
            duration: 225, // 25% Faster
            yoyo: true,
            ease: 'Sine.easeOut'
        });

        // 3. Rapidly change faces
        let rollVal = 1;
        const rollTimer = this.time.addEvent({
            delay: 30, // Faster face changes
            callback: () => {
                rollVal = (rollVal % 6) + 1;
                this.drawDiceFace(rollVal, color);
            },
            loop: true
        });

        this.time.delayedCall(600, () => {
            rollTimer.remove();
            ui.container.angle = 0;
            this.drawDiceFace(value, color);
            
            this.tweens.add({
                targets: ui.container,
                y: this.dicePositions[color].y + (3 * this.mainScale),
                duration: 60,
                yoyo: true,
                ease: 'Sine.easeInOut'
            });
        });
    }

    getVisualPosition(color, pos, index) {
        const { CELL_SIZE } = BOARD_CONFIG;
        const coords = getCoordinates(color, pos, index);
        return {
            x: this.boardX + (coords.x * CELL_SIZE + CELL_SIZE / 2) * this.mainScale,
            y: this.boardY + (coords.y * CELL_SIZE + CELL_SIZE / 2) * this.mainScale,
            gridX: coords.x,
            gridY: coords.y
        };
    }

    createPieces() {
        this.pieceSprites = {};
        ['RED', 'BLUE', 'YELLOW', 'GREEN'].forEach(color => {
            const isActive = this.activePlayers.includes(color);
            this.pieceSprites[color] = this.logic.pieces[color].map((pos, i) => {
                const vis = this.getVisualPosition(color, pos, i);
                const container = this.add.container(vis.x, vis.y);
                container.setScale(this.pieceScale);
                container.setVisible(isActive); // Only show pieces for active players
                
                // Highlight Glow
                const glow = this.add.circle(0, 0, 20, 0xffffff, 0);
                glow.setStrokeStyle(4, 0xffffff);
                glow.setName('glow');
                
                // Drop shadow
                const shadow = this.add.ellipse(0, 10, 24, 12, 0x000000, 0.3);
                
                // Pawn body graphics
                const body = this.add.graphics();
                body.fillStyle(COLORS[color], 1);
                body.lineStyle(2, 0x000000, 0.5);
                
                // Base of pawn
                body.fillEllipse(0, 6, 20, 10);
                body.strokeEllipse(0, 6, 20, 10);
                
                // Middle body
                body.beginPath();
                body.moveTo(-9, 6);
                body.lineTo(-4, -10);
                body.lineTo(4, -10);
                body.lineTo(9, 6);
                body.closePath();
                body.fillPath();
                body.strokePath();
                
                // Pawn head
                body.fillCircle(0, -13, 8);
                body.strokeCircle(0, -13, 8);
                
                // 3D glow/reflection on top left
                const highlight = this.add.circle(-3, -15, 3, 0xffffff, 0.5);
                
                // Overlap badge
                const badgeBg = this.add.circle(10, -18, 9, 0x000000, 0.8).setName('badgeBg').setVisible(false);
                const badgeTx = this.add.text(10, -18, '2', { fontSize: '11px', fill: '#fff' }).setOrigin(0.5).setName('badgeTx').setVisible(false);

                container.add([glow, shadow, body, highlight, badgeBg, badgeTx]);
                container.setDepth(10);
                container.setInteractive(new Phaser.Geom.Circle(0, 0, 15), Phaser.Geom.Circle.Contains);
                container.on('pointerdown', () => this.handlePieceClick(color, i));
                
                return container;
            });
        });
    }

    highlightPossibleMoves() {
        if (this.aiPlayers.includes(this.logic.turn)) return;
        const color = this.logic.turn;
        this.logic.pieces[color].forEach((pos, i) => {
            if (this.logic.canMovePiece(i)) {
                const container = this.pieceSprites[color][i];
                const glow = container.getByName('glow');
                if (glow) {
                    glow.setAlpha(1);
                    this.tweens.add({
                        targets: glow,
                        scale: 1.3,
                        alpha: 0.3,
                        duration: 600,
                        yoyo: true,
                        repeat: -1
                    });
                }
            }
        });
    }

    clearHighlights() {
        ['RED', 'BLUE', 'YELLOW', 'GREEN'].forEach(color => {
            this.pieceSprites[color].forEach(container => {
                const glow = container.getByName('glow');
                if (glow) {
                    this.tweens.killTweensOf(glow);
                    glow.setAlpha(0);
                    glow.setScale(1);
                }
            });
        });
    }

    handlePieceClick(color, index) {
        if (this.mode === 'ONLINE') {
            if (this.logic.turn !== this.playerColor || this.logic.turn !== color) return;
        }
        if (this.aiPlayers.includes(this.logic.turn)) return;
        if (this.logic.turn !== color || this.logic.gameState !== 'WAITING_FOR_MOVE') return;
        if (!this.logic.canMovePiece(index)) return;

        this.executeMove(color, index);
    }

    executeMove(color, index) {
        this.clearHighlights();
        const oldLogPos = this.logic.pieces[color][index];
        const result = this.logic.movePiece(index);
        
        if (result && result.success) {
            if (this.mode === 'ONLINE') {
                // Change local state to 'SYNCING' to prevent any local logic from 
                // re-triggering turn changes during the animation.
                this.logic.gameState = 'SYNCING'; 

                const nextTurn = result.shouldNextTurn ? this.logic.getNextTurn() : this.logic.turn;
                this.online.updateGame(nextTurn, 0, this.logic.pieces);
            }
            // Do NOT snap everything to default positions yet, as it can cause flickering
            // during the start of the walk animation.
            this.updateAllPiecePositions(false, color, index);

            this.animatePath(color, index, result.oldPos, result.newPos, () => {
                if (result.captured && result.captured.length > 0) {
                    this.cameras.main.shake(150, 0.015);

                    result.captured.forEach(cap => {
                        const capSprite = this.pieceSprites[cap.color][cap.index];
                        // Ghost effect starts NOW (attacker just arrived at the same cell)
                        this.tweens.add({
                            targets: capSprite,
                            alpha: 0,
                            scale: this.pieceScale * 2,
                            duration: 600,
                            ease: 'Power2',
                            onComplete: () => {
                                // Move back to base while invisible, then fade in
                                this.updateAllPiecePositions(true);
                                this.tweens.add({
                                    targets: capSprite,
                                    alpha: 1,
                                    scale: this.pieceScale, // Fixed size
                                    duration: 400
                                });
                            }
                        });
                    });

                    this.time.delayedCall(600, () => {
                        this.updateAllPiecePositions(false);
                        const winner = this.logic.checkWinner();
                        if (winner) return this.handleVictory(winner);

                        if (result.shouldNextTurn) {
                            this.goToNextTurn();
                        } else {
                            this.resetDice();
                            this.updateStatusText();
                            this.startTurnTimer();
                            this.checkAITurn();
                        }
                    });
                } else {
                    this.updateAllPiecePositions(false);

                    // Check for victory
                    const winner = this.logic.checkWinner();
                    if (winner) {
                        this.handleVictory(winner);
                        return;
                    }

                    if (result.shouldNextTurn) {
                        // In Online, we already broadcasted the next turn. 
                        // We just need to update local UI once animation ends.
                        if (this.mode !== 'ONLINE') {
                            this.goToNextTurn();
                        } else {
                            this.updateStatusText();
                            this.resetDice();
                        }
                    } else {
                        this.resetDice();
                        this.updateStatusText();
                        this.startTurnTimer();
                        this.checkAITurn();
                    }
                }
            });
        }
    }
    handleVictory(winner) {
        const cx = this.cameras.main.centerX;
        const cy = this.cameras.main.centerY;
        const boardSize = 600 * this.mainScale;
        const winColor = this.getColorHex(winner);
        const colorNameMap = { RED: 'VERMELHO', BLUE: 'AZUL', YELLOW: 'AMARELO', GREEN: 'VERDE' };
        
        // Victory Panel (Board Width)
        const panel = this.add.graphics();
        panel.fillStyle(winColor, 0.9);
        panel.fillRect(cx - boardSize/2, cy - 80, boardSize, 160);
        panel.lineStyle(4, 0xffffff, 1);
        panel.strokeRect(cx - boardSize/2, cy - 80, boardSize, 160);
        panel.setDepth(500).setAlpha(0);

        // Victory Text
        const vicText = this.add.text(cx, cy, `VITÓRIA DO JOGADOR ${colorNameMap[winner]}!`, {
            fontSize: `${36 * this.mainScale}px`,
            fontFamily: 'Arial Black',
            fill: '#ffffff',
            stroke: '#000000',
            strokeThickness: 6,
            align: 'center'
        }).setOrigin(0.5).setDepth(501).setAlpha(0);

        // Animation sequence
        this.tweens.add({
            targets: [panel, vicText],
            alpha: 1,
            duration: 500,
            ease: 'Power2'
        });

        // Confetti effect
        const emitter = this.add.particles(0, 0, 'particle_dot', {
            x: { min: cx - boardSize/2, max: cx + boardSize/2 },
            y: cy - 100,
            lifespan: 2000,
            speedY: { min: 200, max: 400 },
            scale: { start: 0.1, end: 0 },
            alpha: { start: 1, end: 0 },
            tint: [0xffffff, winColor],
            frequency: 50,
            gravityY: 100,
            depth: 502
        });

        this.time.delayedCall(5000, () => {
            if (this.mode === 'ONLINE') {
                this.online.leaveRoom(this.playerColor);
            }
            this.scene.start('MenuScene');
        });
    }

    animatePath(color, index, oldPos, newPos, onComplete) {
        const sprite = this.pieceSprites[color][index];
        this.children.bringToTop(sprite);

        if (oldPos === 0) {
            const pos = this.getVisualPosition(color, newPos, index);
            this.tweens.add({
                targets: sprite,
                x: pos.x,
                y: pos.y,
                duration: 300,
                ease: 'Power2',
                onComplete: onComplete
            });
            return;
        }

        const pathCoords = [];
        for (let p = oldPos + 1; p <= newPos; p++) {
            pathCoords.push(this.getVisualPosition(color, p, index));
        }

        let tweensArray = pathCoords.map(target => ({
            x: target.x,
            y: target.y - 3, // Very small jump UP (3px)
            duration: 70,     // Ascend
            ease: 'Sine.easeOut',
            onComplete: () => {
                // Descend back to grid
                this.tweens.add({
                    targets: sprite,
                    x: target.x,
                    y: target.y,
                    duration: 70, // Descend
                    ease: 'Sine.easeIn'
                });
            }
        }));
        
        this.tweens.chain({
            targets: sprite,
            tweens: tweensArray,
            onComplete: onComplete
        });
    }

    checkAITurn() {
        const turnColor = this.logic.turn;
        const isAI = this.aiPlayers.includes(turnColor);

        // Disable all dice first
        ['RED', 'BLUE', 'YELLOW', 'GREEN'].forEach(color => {
            this.diceUI[color].container.disableInteractive();
        });

        if (isAI) {
            this.time.delayedCall(1000, () => {
                const value = this.logic.rollDice();
                if (value) {
                    this.processRoll(value);
                } else {
                    this.resetDice();
                    this.updateStatusText();
                    this.checkAITurn();
                }
            });
        } else {
            // Online: Only enable if it's actually our turn color
            // Local: Always enable for human turns
            const isMyGlobalTurn = (this.mode !== 'ONLINE' || turnColor === this.playerColor);
            
            if (isMyGlobalTurn) {
                this.diceUI[turnColor].container.setInteractive();
            } else {
                // Ensure other dice are not interactive
                ['RED', 'BLUE', 'YELLOW', 'GREEN'].forEach(color => {
                    this.diceUI[color].container.disableInteractive();
                });
            }
        }
    }

    handleAIMove() {
        const pieceIndex = this.ai.decideMove(this.logic.turn, this.logic.diceRoll);
        if (pieceIndex !== null) {
            this.executeMove(this.logic.turn, pieceIndex);
        } else {
            // No moves possible, logic already called nextTurn
            this.clearHighlights();
            if (this.logic.gameState === 'WAITING_FOR_ROLL') {
                this.resetDice();
            }
            this.checkAITurn();
        }
    }

    updateAllPiecePositions(skipAnimation = false, ignoreColor = null, ignoreIndex = -1) {
        const cellGroups = {};
        const targets = [];
        
        ['RED', 'BLUE', 'YELLOW', 'GREEN'].forEach(color => {
            this.logic.pieces[color].forEach((pos, i) => {
                if (color === ignoreColor && i === ignoreIndex) return;

                const sprite = this.pieceSprites[color][i];
                const vis = this.getVisualPosition(color, pos, i);
                
                if (pos === 0) {
                    targets.push({ sprite, targetX: vis.x, targetY: vis.y, tag: '' });
                } else {
                    const key = `${vis.gridX},${vis.gridY}`;
                    if (!cellGroups[key]) cellGroups[key] = [];
                    cellGroups[key].push({ color, index: i, sprite, vis });
                }
            });
        });

        Object.values(cellGroups).forEach(group => {
            if (group.length === 1) {
                targets.push({ 
                    sprite: group[0].sprite, 
                    targetX: group[0].vis.x, 
                    targetY: group[0].vis.y, 
                    tag: '' 
                });
            } else {
                // Group them by color first
                const colorsCount = {};
                group.forEach(g => { colorsCount[g.color] = (colorsCount[g.color] || 0) + 1; });
                const uniqueColors = Object.keys(colorsCount);
                
                if (uniqueColors.length === 1) {
                    // All same color: stack and tag top
                    group.forEach((g, idx) => {
                        this.children.bringToTop(g.sprite);
                        targets.push({ 
                            sprite: g.sprite, 
                            targetX: g.vis.x, 
                            targetY: g.vis.y, 
                            tag: idx === group.length - 1 ? group.length.toString() : '' 
                        });
                    });
                } else {
                    // Spread
                    group.forEach((g, idx) => {
                        this.children.bringToTop(g.sprite);
                        const angle = (idx / group.length) * Math.PI * 2;
                        const radius = group.length > 2 ? 8 : 6;
                        targets.push({ 
                            sprite: g.sprite, 
                            targetX: g.vis.x + Math.cos(angle) * radius, 
                            targetY: g.vis.y + Math.sin(angle) * radius, 
                            tag: '' 
                        });
                    });
                }
            }
        });

        targets.forEach(t => {
            const badgeBg = t.sprite.getByName('badgeBg');
            const badgeTx = t.sprite.getByName('badgeTx');
            
            if (t.tag) {
                badgeBg.setVisible(true);
                badgeTx.setVisible(true).setText(t.tag);
                t.sprite.bringToTop(badgeBg);
                t.sprite.bringToTop(badgeTx);
            } else {
                badgeBg.setVisible(false);
                badgeTx.setVisible(false);
            }

            if (skipAnimation) {
                t.sprite.x = t.targetX;
                t.sprite.y = t.targetY;
            } else {
                this.tweens.add({
                    targets: t.sprite,
                    x: t.targetX,
                    y: t.targetY,
                    duration: 300,
                    ease: 'Power2'
                });
            }
        });
    }

    showTemporaryMessage(color, text) {
        if (!this.statusTextLabel) return;
        
        // Use the existing label for "Sem jogadas", etc.
        const originalText = this.statusTextLabel.text;
        this.statusTextLabel.setText(text.replace('\n', ' ')).setScale(1.5).setFill('#ffff00');
        
        this.tweens.add({
            targets: this.statusTextLabel,
            scale: 1,
            duration: 400,
            ease: 'Back.easeOut',
            onComplete: () => {
                this.time.delayedCall(1500, () => {
                    if (this.statusTextLabel) {
                        this.statusTextLabel.setText(originalText).setFill('#ffffff');
                    }
                });
            }
        });
    }

    updateStatusText() {
        const turnColor = this.logic.turn;
        if (!this.diceUI) return;
        const ui = this.diceUI[turnColor];
        if (!ui) return;

        // 1. Reset all dice UI state
        ['RED', 'BLUE', 'YELLOW', 'GREEN'].forEach(color => {
            const d = this.diceUI[color];
            d.highlight.setVisible(false);
            const g = d.container.getByName('glow');
            if (g) g.setVisible(false);
            this.tweens.killTweensOf(d.highlight);
            if (g) this.tweens.killTweensOf(g);
            d.container.setAlpha(0.5); 
            d.container.setScale(this.mainScale); // Reset scale
        });

        // 2. Activate current turn's die
        ui.highlight.setVisible(true);
        ui.highlight.setAlpha(1);
        ui.container.setAlpha(1);

        const glow = ui.container.getByName('glow');
        if (glow) glow.setVisible(true);

        // 3. Update Board Border
        this.boardBorder.clear();
        const boardSize = 15 * BOARD_CONFIG.CELL_SIZE * this.mainScale;
        this.boardBorder.lineStyle(4, COLORS[turnColor], 1);
        this.boardBorder.strokeRoundedRect(-2, -2, boardSize + 4, boardSize + 4, 16);

        // 4. Update Timer & Status Label Position
        const offset = this.timerOffsets[turnColor];
        const baseX = ui.container.x + offset.x;
        const baseY = ui.container.y + offset.y;

        const isAI = this.aiPlayers.includes(turnColor);
        const isMyTurn = (this.mode !== 'ONLINE' || turnColor === this.playerColor);

        const stateMsg = this.logic.gameState === 'WAITING_FOR_ROLL' ? 'GIRAR' : 'MOVER';
        
        // Only update text if showTemporaryMessage is not acting
        if (!this.tweens.isTweening(this.statusTextLabel)) {
            this.statusTextLabel.setText(stateMsg).setFill('#ffffff');
        }
        
        this.timerLabel.setText(Math.max(0, this.timeLeft || 0).toString().padStart(2, '0'));

        if (offset.align === 'left') {
            // RED/BLUE: Dado -> Timer -> Texto
            this.timerLabel.setOrigin(0, 0.5).setPosition(baseX, baseY);
            this.statusTextLabel.setOrigin(0, 0.5).setPosition(baseX + 55 * this.mainScale, baseY);
        } else {
            // YELLOW/GREEN: Texto -> Timer -> Dado
            this.timerLabel.setOrigin(1, 0.5).setPosition(baseX, baseY);
            this.statusTextLabel.setOrigin(1, 0.5).setPosition(baseX - 55 * this.mainScale, baseY);
        }

        this.statusContainer.setVisible(isMyTurn);
    }

    goToNextTurn() {
        console.log(`[LocalAction] Turn ending for ${this.logic.turn}. Moving to next.`);
        this.logic.nextTurn();
        console.log(`[LocalAction] New turn set to ${this.logic.turn}. Updating DB.`);
        if (this.mode === 'ONLINE') {
            // Sync with DB: dice = 0 signals turn start
            this.online.updateGame(this.logic.turn, 0, this.logic.pieces);
        }
        this.startTurnTimer();
        this.updateStatusText();
        this.resetDice();
        this.checkAITurn();
    }

    shutdown() {
        if (this.mode === 'ONLINE' && this.online) {
            this.online.leaveRoom(this.playerColor);
        }
    }

    getColorHex(color, returnString = false) {
        const hexes = { RED: 0xff3333, BLUE: 0x0088ff, YELLOW: 0xffd700, GREEN: 0x00ee00 };
        const strings = { RED: '#ff3333', BLUE: '#0088ff', YELLOW: '#ffd700', GREEN: '#00ee00' };
        return returnString ? strings[color] : hexes[color];
    }
}


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
        this.joinedRoom = this.roomId ? { id: this.roomId } : null;
        this.myColor = data?.playerColor;
        this.turnDuration = 10000; // 10 seconds
        
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
        const bg = this.add.image(cx, cy, 'game_bg');
        const scaleX = W / bg.width;
        const scaleY = H / bg.height;
        bg.setScale(Math.max(scaleX, scaleY) || 1);
        
        // Dark overlay so the main playing board stands out clearly
        this.add.rectangle(0, 0, W, H, 0x000000, 0.3).setOrigin(0);

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
            
            this._unloadGame = () => {
                this.online.leaveRoom(this.playerColor);
            };
            window.addEventListener('beforeunload', this._unloadGame);
            
            this.events.on('shutdown', () => {
                window.removeEventListener('beforeunload', this._unloadGame);
            });
        } else {
            this.checkAITurn();
        }

        this.startTurnTimer();
    }

    startTurnTimer() {
        if (this.turnTimer) this.turnTimer.remove();
        this.timeLeft = 10;
        
        const turnColor = this.logic.turn;
        const isAI = this.aiPlayers.includes(turnColor);
        // Show for all human players in Online mode, or current player in Local
        const showLabel = !isAI;

        if (this.timerLabel) {
            this.timerLabel.setText('10');
            this.timerLabel.setVisible(showLabel);
            this.timerLabel.setScale(this.mainScale);
        }

        this.turnTimer = this.time.addEvent({
            delay: 1000,
            repeat: 9,
            callback: () => {
                this.timeLeft--;
                if (this.timerLabel && showLabel) {
                    this.timerLabel.setText(this.timeLeft.toString());
                    // Pop animation
                    if (this.timeLeft <= 3) this.timerLabel.setTint(0xff0000);
                    else this.timerLabel.setTint(0xffffff);
                    this.timerLabel.setScale(this.mainScale * 1.5);
                    this.tweens.add({
                        targets: this.timerLabel,
                        scale: this.mainScale,
                        duration: 300,
                        ease: 'Back.easeOut'
                    });
                }
                this.updateStatusText();
                if (this.timeLeft <= 0) {
                    this.handleTimeout();
                }
            }
        });
    }

    handleTimeout() {
        // Only trigger timeout if it's a human turn (Local or my turn Online)
        if (this.mode === 'ONLINE' && this.logic.turn !== this.playerColor) return;
        if (this.aiPlayers.includes(this.logic.turn)) return;

        this.showTemporaryMessage(this.logic.turn, 'Tempo Esgotado!');
        this.clearHighlights();
        this.resetDice();
        
        this.goToNextTurn();
    }

    goToNextTurn() {
        // Delay removed, transition immediately
        this.logic.nextTurn();
        
        if (this.mode === 'ONLINE') {
            this.online.updateGame(this.logic.turn, 0, this.logic.pieces);
        }
        
        this.updateStatusText();
        this.startTurnTimer();
        this.checkAITurn();
    }

    onOnlineUpdate(state) {
        if (!state) return;
        
        const isDiferentTurn = state.current_turn !== this.logic.turn;
        const isNewRoll = state.last_dice_roll !== this.logic.diceRoll && state.last_dice_roll > 0;
        const isDifferentPieces = JSON.stringify(state.pieces) !== JSON.stringify(this.logic.pieces);

        // If I am the sender, I already have the state updated locally.
        // If I am the receiver, I need to apply these changes.
        if (state.current_turn === this.playerColor) {
            // I am the active player, I trust my local state more unless I just joined
            // or there's a major desync. For now, let's just sync turn if it changed.
            if (isDiferentTurn) {
                this.logic.turn = state.current_turn;
                this.updateStatusText();
                this.startTurnTimer();
            }
            return; 
        }

        // I am the receiver (not my turn)
        if (isDiferentTurn || isNewRoll || isDifferentPieces) {
            const oldRoll = this.logic.diceRoll;
            this.logic.turn = state.current_turn;
            this.logic.diceRoll = state.last_dice_roll;
            this.logic.pieces = state.pieces;
            
            this.updateAllPiecePositions(false);
            this.updateStatusText();
            
            if (isNewRoll) {
                this.processRoll(state.last_dice_roll);
            } else {
                this.drawDiceFace(this.logic.diceRoll);
                this.startTurnTimer();
            }
        }
    }

    drawBoard() {
        const { CELL_SIZE } = BOARD_CONFIG;
        const graphics = this.add.graphics();
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
                
                // Border light - Darker for white cells as requested
                const borderAlpha = fillCol === 0xffffff ? 0.8 : 0.5;
                const borderCol = fillCol === 0xffffff ? 0x000000 : 0x444444;
                graphics.lineStyle(2, borderCol, borderAlpha);
                graphics.strokeRoundedRect(cx, cy, cw, cw, 8);

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
        const diceX = this.cameras.main.centerX;
        const diceY = this.diceY;
        this.diceShadow = this.add.ellipse(diceX, diceY + (25 * this.mainScale), 50 * this.mainScale, 15 * this.mainScale, 0x000000, 0.5);
        
        this.rollButtonContainer = this.add.container(diceX, diceY);
        this.rollButtonContainer.setScale(this.mainScale);
        
        const diceBg = this.add.graphics();
        diceBg.fillStyle(0xffffff, 1);
        diceBg.fillRoundedRect(-30, -30, 60, 60, 12);
        diceBg.lineStyle(3, 0xdddddd, 1);
        diceBg.strokeRoundedRect(-30, -30, 60, 60, 12);
        
        // Inner depth for 3D feel
        diceBg.fillStyle(0xcccccc, 1);
        diceBg.fillRoundedRect(25, -24, 6, 54, 4);
        diceBg.fillRoundedRect(-24, 25, 54, 6, 4);

        this.diceText = this.add.text(0, 0, 'GIRAR', { fontSize: '15px', fill: '#000', fontWeight: 'bold' }).setOrigin(0.5);
        
        // Dice focus highlight (The "porda do dinho" flashing)
        this.diceHighlight = this.add.graphics();
        this.diceHighlight.lineStyle(4, 0xffff00, 1);
        this.diceHighlight.strokeRoundedRect(-32, -32, 64, 64, 14);
        this.diceHighlight.setVisible(false);

        this.diceFace = this.add.graphics();
        
        this.rollButtonContainer.add([diceBg, this.diceHighlight, this.diceText, this.diceFace]);
        
        const hitArea = new Phaser.Geom.Rectangle(-30, -30, 60, 60);
        this.rollButtonContainer.setInteractive(hitArea, Phaser.Geom.Rectangle.Contains, { useHandCursor: true });
        this.rollButtonArea = this.rollButtonContainer; 
        this.rollButtonContainer.on('pointerdown', () => this.handleRoll());

        // New Timer Label to the right of the Dice
        this.timerLabel = this.add.text(diceX + (75 * this.mainScale), diceY, '10', {
            fontSize: `${45 * this.mainScale}px`,
            fontFamily: 'Arial Black, Arial, sans-serif',
            fill: '#ffffff',
            stroke: '#000000',
            strokeThickness: 6
        }).setOrigin(0.5).setDepth(30).setVisible(false);
    }

    resetDice() {
        this.diceText.setFontSize('15px');
        this.diceText.setText('GIRAR');
        this.diceText.setVisible(true);
        if (this.diceFace) this.diceFace.clear();
        if (this.rollButtonContainer) {
            this.rollButtonContainer.angle = 0;
            this.rollButtonContainer.setScale(this.mainScale);
            this.rollButtonContainer.y = this.diceY;
            if (this.diceShadow) {
                this.diceShadow.setScale(1);
                this.diceShadow.setAlpha(0.5);
            }
        }
        if (this.diceHighlight) {
            this.diceHighlight.setVisible(false);
            this.tweens.killTweensOf(this.diceHighlight);
        }
    }

    drawDiceFace(value) {
        this.diceFace.clear();
        this.diceText.setVisible(value === 0);
        
        if (value === 0) return;
        
        this.diceFace.fillStyle(0x222222, 1);
        const positions = [];
        
        if (value === 1 || value === 3 || value === 5) positions.push({x:0, y:0});
        if (value > 1) { positions.push({x:-14, y:-14}); positions.push({x:14, y:14}); }
        if (value > 3) { positions.push({x:14, y:-14}); positions.push({x:-14, y:14}); }
        if (value === 6) { positions.push({x:-14, y:0}); positions.push({x:14, y:0}); }
        
        positions.forEach(p => this.diceFace.fillCircle(p.x, p.y, 6));
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

    processRoll(value) {
        this.updateStatusText();
        this.animateDice(value);
        
        // Wait for dice animation to finish before highlighting or skipping
        this.time.delayedCall(1300, () => {
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

            if (this.aiPlayers.includes(this.logic.turn)) {
                this.time.delayedCall(600, () => this.handleAIMove());
            } else {
                this.highlightPossibleMoves();
            }
        });
    }

    animateDice(value) {
        this.diceText.setVisible(false);
        this.diceFace.clear();

        // 1. Subtle jump and single spin (height reduced by 60%)
        this.tweens.add({
            targets: this.rollButtonContainer,
            y: this.diceY - (10 * this.mainScale), // Jump height reduced
            scaleX: 1.05,
            scaleY: 1.05,
            angle: 360, // 1 full rotation
            duration: 400,
            yoyo: true,
            ease: 'Sine.easeOut'
        });

        // 2. Shrink shadow accordingly
        this.tweens.add({
            targets: this.diceShadow,
            scaleX: 0.6,
            scaleY: 0.6,
            alpha: 0.3,
            duration: 400,
            yoyo: true,
            ease: 'Sine.easeOut'
        });

        // 3. Rapidly change faces while jumping
        let rollVal = 1;
        const rollTimer = this.time.addEvent({
            delay: 50,
            callback: () => {
                rollVal = (rollVal % 6) + 1;
                this.drawDiceFace(rollVal);
            },
            loop: true
        });

        // 4. Stop much sooner to fit the 400ms duration (total 800ms with yoyo)
        this.time.delayedCall(800, () => {
            rollTimer.remove();
            this.rollButtonContainer.angle = 0; // ensure straight
            this.drawDiceFace(value);
            
            // tiny bounce on landing
            this.tweens.add({
                targets: this.rollButtonContainer,
                y: this.diceY + (3 * this.mainScale),
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
                glow.setStrokeStyle(4, 0xffff00);
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
                this.online.updateGame(this.logic.turn, this.logic.diceRoll, this.logic.pieces);
            }
            // Restore overlapping pieces to default position before animating
            this.updateAllPiecePositions(true, color, index);

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

                    // Delay next turn to let ghost effect play out
                    this.time.delayedCall(700, () => {
                        this.updateAllPiecePositions(false);
                        
                        // Check for victory
                        const winner = this.logic.checkWinner();
                        if (winner) {
                            this.handleVictory(winner);
                            return;
                        }

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
                        this.goToNextTurn();
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
        const colorNameMap = { RED: 'VERMELHO', BLUE: 'AZUL', YELLOW: 'AMARELO', GREEN: 'VERDE' };
        const darkColor = DARK_COLORS[winner] || 0x333333;

        // Victory Background (same style as status banner)
        const vicBg = this.add.graphics().setDepth(199).setScale(0);
        
        // Victory Text
        const vicText = this.add.text(cx, cy, `VITÓRIA DO\nJOGADOR ${colorNameMap[winner]}!`, {
            fontSize: '52px',
            fontFamily: 'Arial Black',
            fill: '#ffffff',
            stroke: '#000000',
            strokeThickness: 10,
            align: 'center',
            padding: { x: 40, y: 30 }
        }).setOrigin(0.5).setScale(0).setDepth(200);

        // Draw Background
        const width = vicText.width + 20;
        const height = vicText.height + 20;
        vicBg.setPosition(cx, cy);
        vicBg.fillStyle(darkColor, 0.75); // Slightly more opaque for victory
        vicBg.fillRoundedRect(-width/2, -height/2, width, height, 20);
        vicBg.lineStyle(5, darkColor, 1);
        vicBg.strokeRoundedRect(-width/2, -height/2, width, height, 20);

        // Confetti effect
        const emitter = this.add.particles(0, 0, 'particle_dot', {
            x: { min: 0, max: this.cameras.main.width },
            y: -20,
            lifespan: 3000,
            speedY: { min: 200, max: 500 },
            speedX: { min: -50, max: 50 },
            scale: { start: 0.15, end: 0 },
            alpha: { start: 1, end: 0 },
            tint: [0xff0000, 0x00ff00, 0x0000ff, 0xffff00, 0xffffff],
            frequency: 30,
            blendMode: 'ADD'
        });

        // Intro animation
        this.tweens.add({
            targets: [vicText, vicBg],
            scale: 1,
            angle: 360,
            duration: 1200,
            ease: 'Back.easeOut',
            onComplete: () => {
                // Pulse effect
                this.tweens.add({
                    targets: [vicText, vicBg],
                    scale: 1.05,
                    duration: 500,
                    yoyo: true,
                    repeat: -1,
                    ease: 'Sine.easeInOut'
                });

                this.time.delayedCall(4000, () => {
                    this.scene.start('MenuScene');
                });
            }
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
                duration: 400,
                ease: 'Back.easeOut',
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
            y: target.y,
            duration: 200,
            ease: 'Sine.easeInOut'
        }));
        
        this.tweens.chain({
            targets: sprite,
            tweens: tweensArray,
            onComplete: onComplete
        });
    }

    checkAITurn() {
        if (this.aiPlayers.includes(this.logic.turn)) {
            this.rollButtonArea.disableInteractive();
            this.time.delayedCall(1000, () => {
                const value = this.logic.rollDice();
                if (value) {
                    this.processRoll(value);
                } else {
                    // Logic auto-skipped if no moves
                    this.resetDice();
                    this.updateStatusText();
                    this.checkAITurn();
                }
            });
        } else {
            this.rollButtonArea.setInteractive();
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
        if (this.statusLabel) {
            this.statusLabel.setText(text);
            this.statusLabel.setVisible(true);
            
            // Temporary update to BG for flash
            const darkColor = DARK_COLORS[color];
            const width = this.statusLabel.width + 20;
            const height = this.statusLabel.height + 20;
            this.statusBg.clear();
            this.statusBg.fillStyle(darkColor, 0.8);
            this.statusBg.fillRoundedRect(-width/2, -height/2, width, height, 12);
            this.statusBg.lineStyle(4, 0xffffff, 1);
            this.statusBg.strokeRoundedRect(-width/2, -height/2, width, height, 12);
            
            this.tweens.add({
                targets: this.statusLabel,
                scale: this.mainScale * 1.2,
                duration: 250,
                yoyo: true,
                ease: 'Back.easeOut'
            });
        }
    }

    updateStatusText() {
        const cx = this.cameras.main.centerX;
        const sX = cx - (160 * this.mainScale); // Positioned to the left of the dice
        const sY = this.diceY;

        if (!this.statusLabel) {
            this.statusBg = this.add.graphics().setDepth(29);
            this.statusLabel = this.add.text(sX, sY, '', {
                fontSize: '18px',
                fontFamily: 'Arial Black, Arial, sans-serif',
                fill: '#ffffff', // White text
                fontWeight: 'bold',
                align: 'center',
                padding: { x: 12, y: 6 } // Reduced text padding
            }).setOrigin(0.5).setDepth(30).setAlpha(0.9);

            // Container-like pulse for both bg and label
            this.tweens.add({
                targets: [this.statusLabel, this.statusBg],
                scale: this.mainScale * 1.05,
                duration: 800,
                yoyo: true,
                repeat: -1,
                ease: 'Sine.easeInOut'
            });
        }

        const color = this.logic.turn;
        const colorNameMap = { RED: 'VERMELHO', BLUE: 'AZUL', YELLOW: 'AMARELO', GREEN: 'VERDE' };
        const colorHex = this.getColorHex(color, true);
        
        const stateMsg = this.logic.gameState === 'WAITING_FOR_ROLL' ? 'GIRE O DADO' : 'MOVA A PEÇA';
        let fullMsg = `VEZ DO ${colorNameMap[color]}\n${stateMsg}`;
        
        this.statusLabel.setText(fullMsg);
        this.statusLabel.setVisible(true);
        this.statusLabel.setScale(this.mainScale);

        // Draw Custom Background with Border
        const paddingW = 6; // Reduced horizontal padding
        const paddingH = 4; // Reduced vertical padding
        const width = this.statusLabel.width + paddingW * 2;
        const height = this.statusLabel.height + paddingH * 2;
        
        const darkColor = DARK_COLORS[color];
        
        this.statusBg.clear();
        this.statusBg.setPosition(this.statusLabel.x, this.statusLabel.y);
        this.statusBg.setScale(this.statusLabel.scale);
        
        // Fill: Dark color with 60% transparency
        this.statusBg.fillStyle(darkColor, 0.6);
        this.statusBg.fillRoundedRect(-width/2, -height/2, width, height, 12);
        
        // Border: Same as nest border
        this.statusBg.lineStyle(3, darkColor, 1);
        this.statusBg.strokeRoundedRect(-width/2, -height/2, width, height, 12);
        this.statusBg.setVisible(true);

        // Flashing dice logic
        if (this.logic.gameState === 'WAITING_FOR_ROLL' && !this.aiPlayers.includes(this.logic.turn)) {
            this.diceHighlight.setVisible(true);
            this.tweens.killTweensOf(this.diceHighlight);
            this.tweens.add({
                targets: this.diceHighlight,
                alpha: 0,
                duration: 500,
                yoyo: true,
                repeat: -1
            });
        } else {
            this.diceHighlight.setVisible(false);
            this.tweens.killTweensOf(this.diceHighlight);
        }
    }

    getColorHex(color, returnString = false) {
        const hexes = { RED: 0xff3333, BLUE: 0x0088ff, YELLOW: 0xffd700, GREEN: 0x00ee00 };
        const strings = { RED: '#ff3333', BLUE: '#0088ff', YELLOW: '#ffd700', GREEN: '#00ee00' };
        return returnString ? strings[color] : hexes[color];
    }
}

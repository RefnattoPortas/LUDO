import Phaser from 'phaser';
import { COLORS, BOARD_CONFIG } from '../constants';
import { LudoLogic } from '../logic/LudoLogic';
import { getCoordinates } from '../logic/PathMapping';
import { LudoAI } from '../logic/LudoAI';

export class GameScene extends Phaser.Scene {
    constructor() {
        super('GameScene');
    }

    init(data) {
        this.mode = data?.mode || 'IA';
    }

    preload() {
        this.load.image('game_bg', '/game_bg.png');
    }

    create() {
        const cx = this.cameras.main.centerX;
        const cy = this.cameras.main.centerY;
        
        // Background
        const bg = this.add.image(cx, cy, 'game_bg');
        const scaleX = 640 / bg.width;
        const scaleY = 780 / bg.height;
        bg.setScale(Math.max(scaleX, scaleY) || 1);
        
        // Dark overlay so the main playing board stands out clearly
        this.add.rectangle(0, 0, 640, 780, 0x000000, 0.5).setOrigin(0);

        this.logic = new LudoLogic();
        this.ai = new LudoAI(this.logic);
        
        if (this.mode === 'IA') {
            this.aiPlayers = ['BLUE', 'YELLOW', 'GREEN'];
        } else {
            // Both LOCAL and MULTIPLAYER have empty aiPlayers for now
            this.aiPlayers = [];
        }

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
            this.scene.start('MenuScene');
        });

        this.checkAITurn();
    }

    drawBoard() {
        const { CELL_SIZE } = BOARD_CONFIG;
        const graphics = this.add.graphics();
        graphics.setPosition(20, 60);

        // Board Shadow
        graphics.fillStyle(0x000000, 0.4);
        graphics.fillRoundedRect(-8, -8, 15 * CELL_SIZE + 16, 15 * CELL_SIZE + 16, 20);

        // Base Board fill (Deep dark for high contrast neon)
        graphics.fillStyle(0x111111, 1);
        graphics.fillRoundedRect(0, 0, 15 * CELL_SIZE, 15 * CELL_SIZE, 15);

        for (let x = 0; x < 15; x++) {
            for (let y = 0; y < 15; y++) {
                const isVerticalPath = (x >= 6 && x <= 8);
                const isHorizontalPath = (y >= 6 && y <= 8);
                if (!isVerticalPath && !isHorizontalPath) continue;
                if (x >= 6 && x <= 8 && y >= 6 && y <= 8) continue; // center

                let fillCol = 0x222222; // default dark path
                let isHomePath = false;
                let homeColor = null;

                if (x === 7 && y >= 9 && y <= 13) { fillCol = 0x222222; isHomePath = true; homeColor = "RED"; }
                else if (y === 7 && x >= 1 && x <= 5) { fillCol = 0x222222; isHomePath = true; homeColor = "BLUE"; }
                else if (x === 7 && y >= 1 && y <= 5) { fillCol = 0x222222; isHomePath = true; homeColor = "YELLOW"; }
                else if (y === 7 && x >= 9 && x <= 13) { fillCol = 0x222222; isHomePath = true; homeColor = "GREEN"; }
                
                const cx = x * CELL_SIZE + 2;
                const cy = y * CELL_SIZE + 2;
                const cw = CELL_SIZE - 4;

                // Cell base
                graphics.fillStyle(fillCol, 1);
                graphics.fillRoundedRect(cx, cy, cw, cw, 8);
                
                // Border light
                graphics.lineStyle(1.5, 0x444444, 0.5);
                graphics.strokeRoundedRect(cx, cy, cw, cw, 8);

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
                    // Inner neon
                    graphics.lineStyle(2, 0xffffff, 0.8);
                    graphics.strokeRoundedRect(cx + 10, cy + 10, cw - 20, cw - 20, 2);
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

    drawNeonCell(graphics, x, y, size, color) {
        graphics.lineStyle(3, color, 1);
        graphics.strokeRoundedRect(x, y, size, size, 8);
        graphics.fillStyle(color, 0.2);
        graphics.fillRoundedRect(x, y, size, size, 8);
        graphics.lineStyle(1, 0xffffff, 0.8);
        graphics.strokeRoundedRect(x + 4, y + 4, size - 8, size - 8, 4);
    }

    drawCentralStarburst(graphics) {
        const { CELL_SIZE } = BOARD_CONFIG;
        const cx = 7.5 * CELL_SIZE;
        const cy = 7.5 * CELL_SIZE;
        const size = 3 * CELL_SIZE;
        const startX = 6 * CELL_SIZE;
        const startY = 6 * CELL_SIZE;

        // Background black
        graphics.fillStyle(0x000000, 1);
        graphics.fillRect(startX, startY, size, size);

        // Draw 8-pointed star base
        graphics.lineStyle(2, 0xffffff, 0.5);
        for (let i = 0; i < 8; i++) {
            const angle = (i * Math.PI) / 4;
            const r = size * 0.7;
            graphics.lineBetween(cx, cy, cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
        }

        // Draw colored triangles
        const drawShard = (c, p1x, p1y, p2x, p2y) => {
            graphics.fillStyle(c, 0.3);
            graphics.fillTriangle(p1x, p1y, p2x, p2y, cx, cy);
            graphics.lineStyle(2, c, 1);
            graphics.strokeTriangle(p1x, p1y, p2x, p2y, cx, cy);
            // Neon edge
            graphics.lineStyle(1, 0xffffff, 0.6);
            graphics.lineBetween((p1x + cx)/2, (p1y + cy)/2, (p2x + cx)/2, (p2y + cy)/2);
        };

        drawShard(COLORS.BLUE, startX, startY, startX, startY + size);
        drawShard(COLORS.YELLOW, startX, startY, startX + size, startY);
        drawShard(COLORS.GREEN, startX + size, startY, startX + size, startY + size);
        drawShard(COLORS.RED, startX, startY + size, startX + size, startY + size);

        // Center Nest (Destination)
        graphics.fillStyle(0x111111, 1);
        graphics.fillCircle(cx, cy, 25);
        graphics.lineStyle(3, 0xffffff, 1);
        graphics.strokeCircle(cx, cy, 25);
        graphics.lineStyle(1, 0xffffff, 0.5);
        graphics.strokeCircle(cx, cy, 20);
        
        // Small inner pattern
        graphics.fillStyle(0xffffff, 0.1);
        graphics.fillCircle(cx, cy, 10);
    }

    drawBase(graphics, x, y, color, colorName) {
        const size = 6 * BOARD_CONFIG.CELL_SIZE;
        const baseCx = x + size / 2;
        const baseCy = y + size / 2;

        // Neon Vibrant Frame (Border)
        graphics.lineStyle(6, color, 0.3);
        graphics.strokeRoundedRect(x + 4, y + 4, size - 8, size - 8, 20);
        graphics.lineStyle(3, color, 1);
        graphics.strokeRoundedRect(x + 4, y + 4, size - 8, size - 8, 20);
        graphics.lineStyle(1.5, 0xffffff, 0.8);
        graphics.strokeRoundedRect(x + 6, y + 6, size - 12, size - 12, 18);

        // Main colored area (dimmer to make spots pop)
        graphics.fillStyle(0x111111, 1);
        graphics.fillRoundedRect(x + 10, y + 10, size - 20, size - 20, 16);

        // Internal moldura (contour dark)
        graphics.lineStyle(2, 0x000000, 1);
        graphics.strokeRoundedRect(x + 20, y + 20, size - 40, size - 40, 14);

        // Internal Area Lighter color (same as border/neon)
        graphics.fillStyle(color, 0.15); // subtle fill
        graphics.fillRoundedRect(x + 22, y + 22, size - 44, size - 44, 12);

        // Spots area highlight (clear vibrant neon)
        graphics.lineStyle(2, color, 0.8);
        graphics.strokeRoundedRect(x + 30, y + 30, size - 60, size - 60, 10);

        const offset = BOARD_CONFIG.CELL_SIZE * 1.1; 
        const spots = [
            {cx: baseCx - offset, cy: baseCy - offset},
            {cx: baseCx + offset, cy: baseCy - offset},
            {cx: baseCx - offset, cy: baseCy + offset},
            {cx: baseCx + offset, cy: baseCy + offset}
        ];
        
        spots.forEach(spot => {
            // Dark filled circle where pins sit
            graphics.fillStyle(0x000000, 1);
            graphics.fillCircle(spot.cx, spot.cy, 18);
            
            // Neon accent border
            graphics.lineStyle(2, color, 1);
            graphics.strokeCircle(spot.cx, spot.cy, 18);
            graphics.lineStyle(1, 0xffffff, 0.5);
            graphics.strokeCircle(spot.cx, spot.cy, 15);
        });
    }


    createDiceUI() {
        this.diceShadow = this.add.ellipse(320, 740, 50, 15, 0x000000, 0.5);
        
        this.rollButtonContainer = this.add.container(320, 715);
        
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
        this.diceFace = this.add.graphics();
        
        this.rollButtonContainer.add([diceBg, this.diceText, this.diceFace]);
        
        const hitArea = new Phaser.Geom.Rectangle(-30, -30, 60, 60);
        this.rollButtonContainer.setInteractive(hitArea, Phaser.Geom.Rectangle.Contains, { useHandCursor: true });
        this.rollButtonArea = this.rollButtonContainer; 
        this.rollButtonContainer.on('pointerdown', () => this.handleRoll());
    }

    resetDice() {
        this.diceText.setFontSize('15px');
        this.diceText.setText('GIRAR');
        this.diceText.setVisible(true);
        if (this.diceFace) this.diceFace.clear();
        if (this.rollButtonContainer) {
            this.rollButtonContainer.angle = 0;
            this.rollButtonContainer.setScale(1);
            this.rollButtonContainer.y = 715;
            if (this.diceShadow) {
                this.diceShadow.setScale(1);
                this.diceShadow.setAlpha(0.5);
            }
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
        if (this.aiPlayers.includes(this.logic.turn) || this.logic.gameState !== 'WAITING_FOR_ROLL') return;

        const value = this.logic.rollDice();
        if (value) {
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
                    this.logic.nextTurn();
                    this.updateStatusText();
                    this.checkAITurn();
                });
                return;
            }

            if (!this.logic.canAnyPieceMove()) {
                this.showTemporaryMessage(this.logic.turn, 'Sem\njogadas!');
                this.time.delayedCall(1500, () => {
                    this.clearHighlights();
                    this.resetDice();
                    this.logic.nextTurn();
                    this.updateStatusText();
                    this.checkAITurn();
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

        // 1. Subtle small jump and single spin
        this.tweens.add({
            targets: this.rollButtonContainer,
            y: 650, // lower jump
            scaleX: 1.1,
            scaleY: 1.1,
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
                y: 710,
                duration: 60,
                yoyo: true,
                ease: 'Sine.easeInOut'
            });
        });
    }

    getVisualPosition(color, pos, index) {
        const coords = getCoordinates(color, pos, index);
        // +20 pixel to center in the 40x40 cell, +20 pixel padding for the board + 40 for shift
        return {
            x: coords.x * 40 + 40,
            y: coords.y * 40 + 80, // Board is at y:60 now, +20 = 80
            gridX: coords.x,
            gridY: coords.y
        };
    }

    createPieces() {
        this.pieceSprites = {};
        ['RED', 'BLUE', 'YELLOW', 'GREEN'].forEach(color => {
            this.pieceSprites[color] = this.logic.pieces[color].map((pos, i) => {
                const vis = this.getVisualPosition(color, pos, i);
                const container = this.add.container(vis.x, vis.y);
                
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
            // Restore overlapping pieces to default position before animating
            this.updateAllPiecePositions(true, color, index);

            this.animatePath(color, index, result.oldPos, result.newPos, () => {
                if (result.captured) {
                    this.cameras.main.shake(150, 0.015);
                }

                // Resolve new overlaps with animation
                this.updateAllPiecePositions(false);
                this.updateStatusText();

                // Check if it's the next turn (or extra turn) and if it's AI
                this.time.delayedCall(100, () => {
                    if (this.logic.gameState === 'WAITING_FOR_ROLL') {
                        this.resetDice();
                    }
                    this.checkAITurn();
                });
            });
        }
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
        if (this.statusLabels && this.statusLabels[color]) {
            this.statusLabels[color].setText(text);
            this.statusLabels[color].setVisible(true);
            this.statusLabels[color].setScale(1);
            this.tweens.add({
                targets: this.statusLabels[color],
                scale: 1.15,
                duration: 200,
                yoyo: true
            });
        }
    }

    updateStatusText() {
        if (!this.statusLabels) {
            this.statusLabels = {};
            const { CELL_SIZE } = BOARD_CONFIG;
            const bX = 20; const bY = 60; // Board position
            const bases = {
                BLUE:   { x: bX + 3*CELL_SIZE, y: bY + 3*CELL_SIZE, name: 'AZUL' },
                YELLOW: { x: bX + 12*CELL_SIZE, y: bY + 3*CELL_SIZE, name: 'AMARELO' },
                RED:    { x: bX + 3*CELL_SIZE, y: bY + 12*CELL_SIZE, name: 'VERMELHO' },
                GREEN:  { x: bX + 12*CELL_SIZE, y: bY + 12*CELL_SIZE, name: 'VERDE' },
            };
            ['RED', 'BLUE', 'YELLOW', 'GREEN'].forEach(c => {
                // Static "VEZ DO JOGADOR" with Neon effect
                const colorHex = this.getColorHex(c, true);
                
                const label = this.add.text(bases[c].x, bases[c].y - 45, 'VEZ DO JOGADOR', {
                    fontSize: '14px',
                    fontFamily: 'Arial Black, Arial, sans-serif',
                    fill: '#ffffff',
                    fontWeight: 'bold',
                    align: 'center',
                    stroke: colorHex,
                    strokeThickness: 3,
                    shadow: { color: colorHex, fill: true, offsetX: 0, offsetY: 0, blur: 8 }
                }).setOrigin(0.5).setDepth(15);

                // Add a second layer for stronger glow
                this.add.text(bases[c].x, bases[c].y - 45, 'VEZ DO JOGADOR', {
                    fontSize: '14px',
                    fontFamily: 'Arial Black, Arial, sans-serif',
                    fill: '#ffffff',
                    fontWeight: 'bold',
                    align: 'center',
                    shadow: { color: colorHex, fill: true, offsetX: 0, offsetY: 0, blur: 15 }
                }).setOrigin(0.5).setDepth(14);
                
                // Active action tag
                this.statusLabels[c] = this.add.text(bases[c].x, bases[c].y, '', {
                    fontSize: '15px',
                    fontFamily: 'Arial Black, Arial, sans-serif',
                    fill: '#fff',
                    fontWeight: 'bold',
                    align: 'center',
                    backgroundColor: colorHex,
                    padding: { x: 12, y: 6 },
                    shadow: { color: '#000', fill: true, offsetX: 2, offsetY: 2, blur: 5 }
                }).setOrigin(0.5).setDepth(20).setVisible(false);
                
                // Add border to active tag
                const activeBorder = this.add.graphics().setDepth(19);
                this.statusLabels[c].setData('border', activeBorder);
            });
        }
        
        ['RED', 'BLUE', 'YELLOW', 'GREEN'].forEach(c => {
            const label = this.statusLabels[c];
            const border = label.getData('border');
            
            if (label) {
                if (c === this.logic.turn) {
                    const stateMsg = this.logic.gameState === 'WAITING_FOR_ROLL' ? 'GIRE O DADO' : 'MOVA A PEÇA';
                    label.setText(stateMsg);
                    label.setVisible(true);
                    
                    if (border) {
                        border.clear();
                        border.lineStyle(2, 0xffffff, 1);
                        border.strokeRect(label.x - label.width/2 - 2, label.y - label.height/2 - 2, label.width + 4, label.height + 4);
                        border.setVisible(true);
                    }

                    if (this.tweens.getTweensOf(label).length === 0) {
                        this.tweens.add({
                            targets: label,
                            alpha: { from: 0.7, to: 1 },
                            scale: 1.05,
                            duration: 400,
                            yoyo: true,
                            repeat: -1
                        });
                    }
                } else {
                    label.setVisible(false);
                    if (border) border.setVisible(false);
                    this.tweens.killTweensOf(label);
                    label.setAlpha(1);
                    label.setScale(1);
                }
            }
        });
    }

    getColorHex(color, returnString = false) {
        const hexes = { RED: 0xff3333, BLUE: 0x0088ff, YELLOW: 0xffd700, GREEN: 0x00ee00 };
        const strings = { RED: '#ff3333', BLUE: '#0088ff', YELLOW: '#ffd700', GREEN: '#00ee00' };
        return returnString ? strings[color] : hexes[color];
    }
}

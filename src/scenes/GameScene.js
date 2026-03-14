import Phaser from 'phaser';
import { COLORS, DARK_COLORS, BOARD_CONFIG } from '../constants';
import { LudoLogic } from '../logic/LudoLogic';
import { getCoordinates } from '../logic/PathMapping';
import { LudoAI } from '../logic/LudoAI';
import { LudoOnline } from '../logic/LudoOnline';
import { supabase } from '../supabase';

export class GameScene extends Phaser.Scene {
    constructor() {
        super('GameScene');
    }

    init(data) {
        this.mode = data?.mode || 'IA';
        this.playerColor = data?.playerColor || 'RED';
        this.activePlayers = data?.activePlayers;
        this.isNewMatch = data?.isNewMatch || false;
        this.roomId = data?.roomId;
        this.joinedRoom = this.roomId ? { id: this.roomId } : null;
        this.myColor = data?.playerColor;
        this.turnDuration = 10000; // 10 seconds
        
        // Safety fallback if data is missing or corrupted
        if (!Array.isArray(this.activePlayers) || this.activePlayers.length === 0) {
            this.activePlayers = ['RED', 'BLUE', 'YELLOW', 'GREEN'];
        }

        this.lastStateFingerprint = ''; // To avoid redundant UI refreshes
        this.lastUpdateTimestamp = 0; // To ignore older states arriving late
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
            this.online = new LudoOnline(this.roomId, (state, source) => this.onOnlineUpdate(state, source));
            this.online.joinRoom(this.playerColor, this.activePlayers, this.isNewMatch);
            
            this._unloadGame = () => {
                this.online.leaveRoom(this.playerColor);
            };
            window.addEventListener('beforeunload', this._unloadGame);
            
            this.events.on('shutdown', () => {
                window.removeEventListener('beforeunload', this._unloadGame);
            });

            this.startHeartbeat();
        } else {
            this.checkAITurn();
        }

        this.startTurnTimer();
    }

    startTurnTimer() {
        if (this.turnTimer) this.turnTimer.remove();
        this.timeLeft = 11;
        this.updateStatusText();

        // RUN TIMER VISUALLY FOR EVERYONE
        this.turnTimer = this.time.addEvent({
            delay: 1000,
            repeat: 12,
            callback: () => {
                this.timeLeft--;
                this.updateStatusText();
                
                // Only THE RESPONSIBLE PLAYER (or enforcer) triggers the actual timeout action
                if (this.timeLeft === 0) {
                    this.handleTimeout();
                }
            }
        });

        // Enforcer logic for remote players (stays the same)
        const isMyTurnOnline = this.mode === 'ONLINE' && this.logic.turn === this.playerColor;
        const isLocalHumanTurn = this.mode !== 'ONLINE' && !this.aiPlayers.includes(this.logic.turn);

        if (!isMyTurnOnline && !isLocalHumanTurn && this.mode === 'ONLINE') {
            this._enforcerTurnSnapshot = `${this.logic.turn}-${JSON.stringify(this.logic.pieces)}`;
            this.time.delayedCall(18000, () => this.forceNonRespondingTimeout());
        }
    }


    handleTimeout() {
        // Only trigger timeout if it's a human turn (Local or my turn Online)
        if (this.mode === 'ONLINE' && this.logic.turn !== this.playerColor) return;
        if (this.aiPlayers.includes(this.logic.turn)) return;

        this.showTemporaryMessage(this.logic.turn, 'Auto\nJogando...');
        this.triggerAutoMove();
    }

    forceNonRespondingTimeout() {
        // Check if the state has changed since we started the enforcer timer
        const currentSnapshot = `${this.logic.turn}-${JSON.stringify(this.logic.pieces)}`;
        if (currentSnapshot !== this._enforcerTurnSnapshot) {
            // State already changed, the remote player acted — do nothing
            console.log('[Enforcer] Snapshot changed, remote player already acted.');
            return;
        }

        // Only fire if it's still the remote player's turn
        if (this.mode === 'ONLINE' && this.logic.turn !== this.playerColor) {
            // Only the player whose color comes first alphabetically among the others should enforce
            const others = this.activePlayers.filter(p => p !== this.logic.turn);
            const enforcer = others.sort()[0];

            if (this.playerColor === enforcer) {
                console.warn('[Enforcer] Triggering remote timeout for:', this.logic.turn);
                this.showTemporaryMessage(this.logic.turn, 'Jogador\nAusente...');
                this.triggerAutoMoveForColor(this.logic.turn);
            } else {
                console.log('[Enforcer] Not the enforcer, waiting:', enforcer);
            }
        }
    }

    triggerAutoMove() {
        // Stop current animation if any
        this.isAnimating = false;
        this.clearHighlights();
        
        if (this.logic.gameState === 'WAITING_FOR_ROLL') {
            this.forceAITurn = true;
            const value = this.logic.rollDice();
            if (value) {
                if (this.mode === 'ONLINE') {
                    const now = new Date().toISOString();
                    this.lastUpdateTimestamp = new Date(now).getTime();
                    this.lastStateFingerprint = `${this.logic.turn}-${value}-${JSON.stringify(this.logic.pieces)}`;
                    this.online.updateGame(this.logic.turn, value, this.logic.pieces, this.logic.gameState, now);
                }
                this.processRoll(value);
            }
        } else {
            this.forceAITurn = true;
            this.handleAIMove();
        }
    }

    triggerAutoMoveForColor(color) {
        // Called by enforcer for a remote player that is not responding
        // Temporarily act as that player's AI
        if (this.logic.turn !== color) return;
        this.clearHighlights();
        if (this.logic.gameState === 'WAITING_FOR_ROLL') {
            const value = this.logic.rollDice();
            if (value) {
                this.online.updateGame(this.logic.turn, value, this.logic.pieces, this.logic.gameState);
                // Process locally so enforcer sees the result and can send move too
                const savedAI = this.forceAITurn;
                this.forceAITurn = true;
                this.processRoll(value);
                this.forceAITurn = savedAI;
            }
        } else if (this.logic.gameState === 'WAITING_FOR_MOVE') {
            const pieceIndex = this.ai.decideMove(this.logic.turn, this.logic.diceRoll);
            if (pieceIndex !== null) {
                this.clearHighlights();
                const oldLogPos = this.logic.pieces[color][pieceIndex];
                const result = this.logic.movePiece(pieceIndex);
                if (result && result.success) {
                    this.online.updateGame(this.logic.turn, this.logic.diceRoll, this.logic.pieces, this.logic.gameState);
                    this.animatePath(color, pieceIndex, result.oldPos, result.newPos, () => {
                        this.updateAllPiecePositions(false);
                        const winner = this.logic.checkWinner();
                        if (winner) { this.handleVictory(winner); return; }
                        if (result.shouldNextTurn) {
                            this.goToNextTurn();
                        } else {
                            this.resetDice();
                            this.updateStatusText();
                            this.startTurnTimer();
                        }
                    });
                }
            } else {
                // No moves: pass turn
                this.logic.nextTurn();
                this.online.updateGame(this.logic.turn, 0, this.logic.pieces, this.logic.gameState);
                this.updateStatusText();
                this.startTurnTimer();
            }
        }
    }

    startHeartbeat() {
        this.heartbeatTimer = this.time.addEvent({
            delay: 10000, // Every 10 seconds
            callback: async () => {
                if (this.mode === 'ONLINE' && this.roomId && this.playerColor) {
                    await supabase
                        .from('ludo_players')
                        .update({ last_active: new Date() })
                        .match({ room_id: this.roomId, color: this.playerColor });
                }
            },
            loop: true
        });
    }

    goToNextTurn() {
        const oldTurn = this.logic.turn;
        this.logic.nextTurn();
        const newTurn = this.logic.turn;
        
        console.log(`[TurnTransition] From ${oldTurn} to ${newTurn}`);

        if (this.mode === 'ONLINE') {
            const now = new Date().toISOString();
            this.lastUpdateTimestamp = new Date(now).getTime();
            this.lastStateFingerprint = `${newTurn}-0-${JSON.stringify(this.logic.pieces)}`;
            this.online.updateGame(newTurn, 0, this.logic.pieces, this.logic.gameState, now);
        }
        
        this.updateStatusText();
        this.startTurnTimer();
        this.checkAITurn();
    }

    onOnlineUpdate(state, source) {
        if (!state) return;

        // 1. Timestamp safety: ignore older updates
        const updateTime = state.updated_at ? new Date(state.updated_at).getTime() : 0;
        if (source !== 'INITIAL' && updateTime < this.lastUpdateTimestamp) {
            console.log(`[${source}] Ignoring stale update (${updateTime} < ${this.lastUpdateTimestamp})`);
            return;
        }
        this.lastUpdateTimestamp = updateTime;

        const fingerprint = `${state.current_turn}-${state.last_dice_roll}-${JSON.stringify(state.pieces)}`;
        if (fingerprint === this.lastStateFingerprint && source !== 'INITIAL') {
            return;
        }

        // If we are currently animating a local move, defer non-essential updates 
        // to avoid snapping pieces or skipping turns.
        if (this.isAnimating && source !== 'INITIAL' && state.current_turn === this.playerColor) {
            console.log(`[${source}] Deferring update while animating...`);
            return;
        }

        this.lastStateFingerprint = fingerprint;
        const serverGameState = state.pieces?._state || 'WAITING_FOR_ROLL';

        // Clean pieces metadata from pieces mapping
        const remotePieces = JSON.parse(JSON.stringify(state.pieces));
        delete remotePieces._state;

        // Capture pre-update state for comparisons and animation
        const isTurnChange = state.current_turn !== this.logic.turn;
        
        // Better roll detection: check value AND state transition (helps with consecutive same values)
        const isNewRoll = (state.last_dice_roll > 0) && (
            state.last_dice_roll !== this.logic.diceRoll || 
            (serverGameState === 'WAITING_FOR_MOVE' && this.logic.gameState === 'WAITING_FOR_ROLL')
        );

        const isDifferentPieces = JSON.stringify(remotePieces) !== JSON.stringify(this.logic.pieces);
        const oldPieces = JSON.parse(JSON.stringify(this.logic.pieces));

        console.log(`[${source}] Turn=${state.current_turn}, Roll=${state.last_dice_roll}, State=${serverGameState}, LocalTurn=${this.logic.turn}, isAnimating=${this.isAnimating}`);

        // Stop stale local timers on any meaningful update
        if ((isTurnChange || isNewRoll || isDifferentPieces) && this.turnTimer) {
            this.turnTimer.remove();
            this.turnTimer = null;
        }

        // === FULLY APPLY SERVER STATE (always, for all clients) ===
        // Safety: If we are animating, only update Turn if it's a confirmed transition from someone else
        if (!this.isAnimating || isTurnChange) {
            this.logic.turn = state.current_turn;
            this.logic.diceRoll = state.last_dice_roll || 0;
            this.logic.pieces = remotePieces;
            this.logic.gameState = serverGameState;
        }

        this.clearHighlights();
        this.updateStatusText();

        // === MY TURN: enable interaction ===
        if (state.current_turn === this.playerColor) {
            if (isTurnChange || source === 'INITIAL') {
                // New turn started for me — reset local safety states
                this.logic.consecutiveSixes = 0;
                this.isAnimating = false; 
                this.updateAllPiecePositions(false);
                if (serverGameState === 'WAITING_FOR_ROLL') {
                    this.resetDice();
                } else if (serverGameState === 'WAITING_FOR_MOVE' && this.logic.diceRoll > 0) {
                    this.drawDiceFace(this.logic.diceRoll);
                    this.highlightPossibleMoves();
                }
                this.startTurnTimer();
            }
            return;
        }

        // === OBSERVER: show what someone else is doing ===

        // Animate dice
        if (isNewRoll) {
            this.animateDice(this.logic.diceRoll);
        } else if (isTurnChange) {
            this.resetDice();
        } else if (this.logic.diceRoll > 0) {
            this.drawDiceFace(this.logic.diceRoll);
        }

        // Animate piece movement
        let movedPiece = null;
        if (isDifferentPieces) {
            for (const color of ['RED', 'BLUE', 'YELLOW', 'GREEN']) {
                for (let i = 0; i < 4; i++) {
                    if (oldPieces[color][i] !== remotePieces[color][i]) {
                        movedPiece = { color, index: i, oldPos: oldPieces[color][i], newPos: remotePieces[color][i] };
                        break;
                    }
                }
                if (movedPiece) break;
            }
        }

        if (movedPiece) {
            // Temporarily restore old piece positions so animation starts from correct spot
            this.logic.pieces = oldPieces;
            this.animatePath(movedPiece.color, movedPiece.index, movedPiece.oldPos, movedPiece.newPos, () => {
                this.logic.pieces = remotePieces;
                this.updateAllPiecePositions(true);

                // Capture ghost effect
                for (const color of ['RED', 'BLUE', 'YELLOW', 'GREEN']) {
                    for (let i = 0; i < 4; i++) {
                        if (oldPieces[color][i] !== 0 && remotePieces[color][i] === 0
                            && (color !== movedPiece.color || i !== movedPiece.index)) {
                            const capSprite = this.pieceSprites[color][i];
                            this.cameras.main.shake(150, 0.01);
                            this.tweens.add({
                                targets: capSprite,
                                alpha: 0,
                                scale: this.pieceScale * 2,
                                duration: 500,
                                onComplete: () => {
                                    this.updateAllPiecePositions(true);
                                    this.tweens.add({ targets: capSprite, alpha: 1, scale: this.pieceScale, duration: 300 });
                                }
                            });
                        }
                    }
                }
            });
        } else if (isDifferentPieces || isTurnChange) {
            this.updateAllPiecePositions(true);
        }

        // Start enforcer timer for the remote player's turn
        if (isTurnChange || source === 'INITIAL') {
            this.startTurnTimer();
        }

        const winner = this.logic.checkWinner();
        if (winner) this.handleVictory(winner);
    }

    drawBoard() {
        const { CELL_SIZE } = BOARD_CONFIG;

        // Dynamic border that will change color based on turn
        this.dynamicBoardBorder = this.add.graphics();
        this.dynamicBoardBorder.setPosition(this.boardX, this.boardY);
        this.dynamicBoardBorder.setScale(this.mainScale);
        this.dynamicBoardBorder.setDepth(15); // Above the board base, below pieces

        // Pulse effect for the board border
        this.tweens.add({
            targets: this.dynamicBoardBorder,
            alpha: 0.6,
            duration: 800,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut'
        });

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
        // Create 4 fixed dice, one per player color position
        const diceColors = ['RED', 'BLUE', 'YELLOW', 'GREEN'];
        this.diceContainers = {};
        this.diceFaces = {};
        this.diceTexts = {};
        this.diceBorders = {};
        this.diceShadows = {};
        this.dicePulseTweens = {};

        diceColors.forEach(color => {
            if (!this.activePlayers.includes(color)) return;

            const pos = this.getDicePosition(color);

            const shadow = this.add.ellipse(pos.x, pos.y + (25 * this.mainScale), 50 * this.mainScale, 15 * this.mainScale, 0x000000, 0.5);
            this.diceShadows[color] = shadow;

            const container = this.add.container(pos.x, pos.y);
            container.setScale(this.mainScale);

            const diceBg = this.add.graphics();
            diceBg.fillStyle(0xffffff, 1);
            diceBg.fillRoundedRect(-30, -30, 60, 60, 12);
            diceBg.lineStyle(3, 0xdddddd, 1);
            diceBg.strokeRoundedRect(-30, -30, 60, 60, 12);
            // Inner depth for 3D feel
            diceBg.fillStyle(0xcccccc, 1);
            diceBg.fillRoundedRect(25, -24, 6, 54, 4);
            diceBg.fillRoundedRect(-24, 25, 54, 6, 4);

            const diceText = this.add.text(0, 0, 'GIRAR', { fontSize: '15px', fill: '#000', fontWeight: 'bold' }).setOrigin(0.5);
            const diceBorder = this.add.graphics();
            const diceFace = this.add.graphics();

            container.add([diceBorder, diceBg, diceText, diceFace]);

            const hitArea = new Phaser.Geom.Rectangle(-30, -30, 60, 60);
            container.setInteractive(hitArea, Phaser.Geom.Rectangle.Contains, { useHandCursor: true });
            container.on('pointerdown', () => this.handleRoll());

            this.diceContainers[color] = container;
            this.diceFaces[color] = diceFace;
            this.diceTexts[color] = diceText;
            this.diceBorders[color] = diceBorder;
        });

        // Timer label - positioned near active dice
        const initColor = this.activePlayers[0];
        const initPos = this.getDicePosition(initColor);
        const isLeft = (initColor === 'RED' || initColor === 'BLUE');
        const sideOffset = isLeft ? 55 * this.mainScale : -55 * this.mainScale;

        this.timerLabel = this.add.text(initPos.x + sideOffset, initPos.y, '', {
            fontSize: '20px',
            fontFamily: 'Arial Black, Arial, sans-serif',
            fill: '#ffffff',
            stroke: '#000000',
            strokeThickness: 5
        }).setOrigin(isLeft ? 0 : 1, 0.5).setDepth(200);

        // Aliases for backward compat (used as the "active" dice)
        this._setActiveDice(initColor);
    }

    _setActiveDice(color) {
        const INACTIVE_ALPHA = 0.3; // How faded inactive dice appear

        // Stop all pulse tweens and dim all dice
        Object.keys(this.diceContainers).forEach(c => {
            // Stop pulse tween
            if (this.dicePulseTweens[c]) {
                this.dicePulseTweens[c].stop();
                this.dicePulseTweens[c] = null;
            }
            // Dim the entire container (not just border)
            const container = this.diceContainers[c];
            if (container) container.setAlpha(INACTIVE_ALPHA);
            // Clear border
            const border = this.diceBorders[c];
            if (border) { border.clear(); border.setAlpha(0.15); }
            // Dim shadow
            const shadow = this.diceShadows[c];
            if (shadow) shadow.setAlpha(0.15);
        });

        // Set the active dice aliases
        this.rollButtonContainer = this.diceContainers[color];
        this.rollButtonArea = this.rollButtonContainer;
        this.dynamicDiceBorder = this.diceBorders[color];
        this.diceFace = this.diceFaces[color];
        this.diceText = this.diceTexts[color];
        this.diceShadow = this.diceShadows[color];
        this.currentDicePos = this.getDicePosition(color);
        this.currentDiceY = this.currentDicePos.y;

        // Fully activate the active dice
        if (this.rollButtonContainer) this.rollButtonContainer.setAlpha(1);
        if (this.diceShadow) this.diceShadow.setAlpha(0.5);

        // Activate pulse tween on active border
        if (this.dynamicDiceBorder) {
            this.dynamicDiceBorder.setAlpha(1);
            this.dicePulseTweens[color] = this.tweens.add({
                targets: this.dynamicDiceBorder,
                alpha: 0.6,
                duration: 800,
                yoyo: true,
                repeat: -1,
                ease: 'Sine.easeInOut'
            });
        }
    }

    resetDice() {
        // Reset ALL dice faces to GIRAR state, but respect active/inactive alpha
        const activeTurn = this.logic.turn;
        const INACTIVE_ALPHA = 0.3;

        Object.keys(this.diceTexts).forEach(c => {
            const isActive = (c === activeTurn);
            const dt = this.diceTexts[c];
            if (dt) { dt.setFontSize('15px'); dt.setText('GIRAR'); dt.setVisible(true); }
            const df = this.diceFaces[c];
            if (df) df.clear();
            const dc = this.diceContainers[c];
            if (dc) {
                dc.angle = 0;
                dc.setScale(this.mainScale);
                dc.y = this.getDicePosition(c).y;
                dc.setAlpha(isActive ? 1 : INACTIVE_ALPHA);
            }
            const ds = this.diceShadows[c];
            if (ds) ds.setAlpha(isActive ? 0.5 : 0.15);
        });
        if (this.dynamicDiceBorder) {
            this.dynamicDiceBorder.setVisible(true);
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

    _drawDiceFaceOn(color, value) {
        const df = this.diceFaces[color];
        const dt = this.diceTexts[color];
        if (!df || !dt) return;
        df.clear();
        dt.setVisible(value === 0);
        if (value === 0) return;
        df.fillStyle(0x222222, 1);
        const positions = [];
        if (value === 1 || value === 3 || value === 5) positions.push({x:0, y:0});
        if (value > 1) { positions.push({x:-14, y:-14}); positions.push({x:14, y:14}); }
        if (value > 3) { positions.push({x:14, y:-14}); positions.push({x:-14, y:14}); }
        if (value === 6) { positions.push({x:-14, y:0}); positions.push({x:14, y:0}); }
        positions.forEach(p => df.fillCircle(p.x, p.y, 6));
    }

    handleRoll() {
        if (this.isAnimating) return; // Block while moving
        if (this.mode === 'ONLINE') {
            if (this.logic.turn !== this.playerColor || this.logic.gameState !== 'WAITING_FOR_ROLL') return;
        } else if (this.aiPlayers.includes(this.logic.turn) || this.logic.gameState !== 'WAITING_FOR_ROLL') {
            return;
        }

        const value = this.logic.rollDice();
        if (value) {
            if (this.mode === 'ONLINE') {
                const now = new Date().toISOString();
                this.lastUpdateTimestamp = new Date(now).getTime();
                // Set local fingerprint before sending to ignore the echo
                this.lastStateFingerprint = `${this.logic.turn}-${value}-${JSON.stringify(this.logic.pieces)}`;
                this.online.updateGame(this.logic.turn, value, this.logic.pieces, this.logic.gameState, now);
            }
            this.processRoll(value);
        }
    }

    processRoll(value) {
        // Capture the turn color NOW, before any async delays can change it
        const rollingColor = this.logic.turn;
        const rollingConsecSixes = this.logic.consecutiveSixes;

        this.updateStatusText();
        this.animateDice(value, rollingColor);
        
        // Wait for dice animation to finish before highlighting or skipping
        this.time.delayedCall(1300, () => {
            // Safety check: if turn has changed (online sync), abort
            if (this.mode === 'ONLINE' && this.logic.turn !== rollingColor) return;

            if (rollingConsecSixes >= 3) {
                this.showTemporaryMessage(rollingColor, 'Perdeu a vez\n(3 seis)!');
                this.time.delayedCall(1500, () => {
                    this.clearHighlights();
                    this.resetDice();
                    this.forceAITurn = false;
                    this.goToNextTurn();
                });
                return;
            }

            if (!this.logic.canAnyPieceMove()) {
                this.showTemporaryMessage(rollingColor, 'Sem\njogadas!');
                this.time.delayedCall(1500, () => {
                    this.clearHighlights();
                    this.resetDice();
                    this.forceAITurn = false;
                    this.goToNextTurn();
                });
                return;
            }

            // AI move: only execute if it's still that color's turn
            if (this.aiPlayers.includes(rollingColor) || this.forceAITurn) {
                if (this.logic.turn !== rollingColor) return; // Safety: turn changed
                this.time.delayedCall(600, () => {
                    if (this.logic.turn !== rollingColor) return; // Safety again
                    this.handleAIMove();
                    this.forceAITurn = false;
                });
            } else {
                this.highlightPossibleMoves();
            }
        });
    }

    animateDice(value, forColor) {
        // Capture references at call time — the active dice aliases may change
        // (e.g. turn advances mid-animation in online mode)
        const color = forColor || this.logic.turn;
        const container = this.diceContainers[color];
        const face = this.diceFaces[color];
        const text = this.diceTexts[color];
        const shadow = this.diceShadows[color];
        const diceY = this.getDicePosition(color).y;

        if (!container || !face || !text) return;

        text.setVisible(false);
        face.clear();

        // 1. Subtle jump and single spin (scale relative to mainScale)
        this.tweens.add({
            targets: container,
            y: diceY - (10 * this.mainScale),
            scaleX: this.mainScale * 1.05,
            scaleY: this.mainScale * 1.05,
            angle: 360,
            duration: 400,
            ease: 'Sine.easeOut',
            onComplete: () => {
                container.setScale(this.mainScale);
            }
        });

        // 2. Shrink shadow accordingly
        if (shadow) {
            this.tweens.add({
                targets: shadow,
                scaleX: 0.6,
                scaleY: 0.6,
                alpha: 0.3,
                duration: 400,
                yoyo: true,
                ease: 'Sine.easeOut'
            });
        }

        // 3. Rapidly change faces while jumping
        let rollVal = 1;
        const rollTimer = this.time.addEvent({
            delay: 50,
            callback: () => {
                rollVal = (rollVal % 6) + 1;
                this._drawDiceFaceOn(color, rollVal);
            },
            loop: true
        });

        // 4. Stop and show final value
        this.time.delayedCall(800, () => {
            rollTimer.remove();
            container.angle = 0;
            container.setScale(this.mainScale);
            this._drawDiceFaceOn(color, value);
            
            // Tiny bounce on landing
            this.tweens.add({
                targets: container,
                y: diceY + (3 * this.mainScale),
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
                glow.setVisible(false);
                
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
                    glow.setVisible(true);
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
                    glow.setVisible(false);
                    glow.setAlpha(0);
                    glow.setScale(1);
                }
            });
        });
    }

    handlePieceClick(color, index) {
        if (this.isAnimating) return; // Block while moving
        if (this.mode === 'ONLINE') {
            if (this.logic.turn !== this.playerColor || this.logic.turn !== color) return;
        }
        if (this.aiPlayers.includes(this.logic.turn)) return;
        if (this.logic.turn !== color || this.logic.gameState !== 'WAITING_FOR_MOVE') return;
        if (!this.logic.canMovePiece(index)) return;

        this.executeMove(color, index);
    }

    executeMove(color, index) {
        this.isAnimating = true;
        this.clearHighlights();
        const oldLogPos = this.logic.pieces[color][index];
        const result = this.logic.movePiece(index);
        
        if (result && result.success) {
            if (this.mode === 'ONLINE') {
                const now = new Date().toISOString();
                this.lastUpdateTimestamp = new Date(now).getTime();
                // Update local fingerprint immediately to ignore our own echo
                this.lastStateFingerprint = `${this.logic.turn}-${this.logic.diceRoll}-${JSON.stringify(this.logic.pieces)}`;
                this.online.updateGame(this.logic.turn, this.logic.diceRoll, this.logic.pieces, this.logic.gameState, now);
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
                    this.time.delayedCall(800, () => {
                        this.isAnimating = false;
                        this.updateAllPiecePositions(false);
                        
                        // Check for victory
                        const winner = this.logic.checkWinner();
                        if (winner) {
                            this.handleVictory(winner);
                            return;
                        }

                        if (result.shouldNextTurn) {
                            // Safety: verify we still own the turn before passing it
                            if (this.logic.turn === color || this.mode !== 'ONLINE') {
                                this.goToNextTurn();
                            }
                        } else {
                            this.resetDice();
                            this.updateStatusText();
                            this.startTurnTimer();
                            this.checkAITurn();
                        }
                    });
                } else {
                    this.isAnimating = false;
                    this.updateAllPiecePositions(false);

                    // Check for victory
                    const winner = this.logic.checkWinner();
                    if (winner) {
                        this.handleVictory(winner);
                        return;
                    }

                    if (result.shouldNextTurn) {
                        // Safety: verify we still own the turn before passing it
                        if (this.logic.turn === color || this.mode !== 'ONLINE') {
                            this.goToNextTurn();
                        }
                    } else {
                        this.resetDice();
                        this.updateStatusText();
                        this.startTurnTimer();
                        this.checkAITurn();
                    }
                }
            });
        } else {
            this.isAnimating = false;
        }
    }

    handleVictory(winner) {
        if (this.victoryTriggered) return;
        this.victoryTriggered = true;

        const cx = this.cameras.main.centerX;
        const cy = this.cameras.main.centerY;
        const colorNameMap = { RED: 'VERMELHO', BLUE: 'AZUL', YELLOW: 'AMARELO', GREEN: 'VERDE' };
        const darkColor = DARK_COLORS[winner] || 0x333333;

        // Make width exactly equal to scaled board size
        const baseBoardSize = 15 * BOARD_CONFIG.CELL_SIZE;
        const scaledBoardSize = baseBoardSize * this.mainScale;

        // Victory Background (same style as status banner)
        const vicBg = this.add.graphics().setDepth(199).setScale(0);
        
        // Victory Text
        const fontSizeStr = Math.floor(45 * this.mainScale) + 'px';
        const vicText = this.add.text(cx, cy, `VITÓRIA DO\nJOGADOR ${colorNameMap[winner]}!`, {
            fontSize: fontSizeStr,
            fontFamily: 'Arial Black',
            fill: '#ffffff',
            stroke: '#000000',
            strokeThickness: 8,
            align: 'center',
            padding: { x: 20, y: 20 },
            wordWrap: { width: scaledBoardSize * 0.9, useAdvancedWrap: true }
        }).setOrigin(0.5).setScale(0).setDepth(200);

        // Draw Background
        const width = scaledBoardSize;
        const height = vicText.height + 40;
        vicBg.setPosition(cx, cy);
        vicBg.fillStyle(darkColor, 0.85); // Slightly more opaque for victory
        vicBg.fillRoundedRect(-width/2, -height/2, width, height, 20);
        vicBg.lineStyle(6, 0xffffff, 1);
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
        const currentTurn = this.logic.turn;
        if (this.aiPlayers.includes(currentTurn)) {
            // Disable the human player's dice while AI is playing
            const humanColor = this.activePlayers.find(c => !this.aiPlayers.includes(c));
            if (humanColor && this.diceContainers[humanColor]) {
                this.diceContainers[humanColor].disableInteractive();
            }
            this.time.delayedCall(1000, () => {
                // Safety: verify it's still this AI's turn
                if (this.logic.turn !== currentTurn) return;
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
            // Re-enable the human player's dice
            if (this.rollButtonArea) this.rollButtonArea.setInteractive();
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
            
            if (this.mode === 'ONLINE') {
                this.online.updateGame(this.logic.turn, 0, this.logic.pieces);
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
        if (!this.currentDicePos) return;
        
        // Offset towards the inside of the board
        const sideOffset = (color === 'RED' || color === 'BLUE') ? 110 * this.mainScale : -110 * this.mainScale;
        
        const msg = this.add.text(this.currentDicePos.x + sideOffset, this.currentDicePos.y, text, {
            fontSize: '22px',
            fontFamily: 'Arial Black, Arial, sans-serif',
            fill: '#ffffff',
            stroke: '#000000',
            strokeThickness: 5,
            align: 'center'
        }).setOrigin(0.5).setDepth(100).setScale(this.mainScale);

        this.tweens.add({
            targets: msg,
            y: msg.y - (30 * this.mainScale),
            alpha: 0,
            duration: 1500,
            ease: 'Power2',
            onComplete: () => msg.destroy()
        });
    }

    updateStatusText() {
        const color = this.logic.turn;
        this._setActiveDice(color); // Switch active dice to current player

        const pos = this.getDicePosition(color);
        const isLeft = (color === 'RED' || color === 'BLUE');
        const sideOffset = isLeft ? 55 * this.mainScale : -55 * this.mainScale;

        // Move timer label to active dice position
        if (this.timerLabel) {
            this.timerLabel.setOrigin(isLeft ? 0 : 1, 0.5);
            this.timerLabel.setPosition(pos.x + sideOffset, pos.y);
            
            if (this.timeLeft >= 0 && !this.aiPlayers.includes(color)) {
                this.timerLabel.setText(this.timeLeft.toString() + 's');
                this.timerLabel.setTint(this.timeLeft <= 3 ? 0xff0000 : 0xffffff);
            } else {
                this.timerLabel.setText('');
            }
        }

        const darkColor = DARK_COLORS[color];
        
        // Update the dynamic dice border (the active one was set in _setActiveDice)
        if (this.dynamicDiceBorder) {
            this.dynamicDiceBorder.clear();
            this.dynamicDiceBorder.lineStyle(10, darkColor, 1);
            this.dynamicDiceBorder.strokeRoundedRect(-36, -36, 72, 72, 16);
            this.dynamicDiceBorder.lineStyle(3, COLORS[color], 1);
            this.dynamicDiceBorder.strokeRoundedRect(-36, -36, 72, 72, 16);
        }

        // Update the dynamic board border
        if (this.dynamicBoardBorder) {
            this.dynamicBoardBorder.clear();
            const boardSize = 15 * BOARD_CONFIG.CELL_SIZE;
            this.dynamicBoardBorder.lineStyle(12, darkColor, 1);
            this.dynamicBoardBorder.strokeRoundedRect(-6, -6, boardSize + 12, boardSize + 12, 18);
            this.dynamicBoardBorder.lineStyle(4, COLORS[color], 1);
            this.dynamicBoardBorder.strokeRoundedRect(-6, -6, boardSize + 12, boardSize + 12, 18);
        }
    }

    getDicePosition(color) {
        const boardSize = 15 * BOARD_CONFIG.CELL_SIZE * this.mainScale;
        const padX = 40 * this.mainScale;
        const padYBottom = 75 * this.mainScale;
        const padYTop = 80 * this.mainScale;
        
        let topY = this.boardY - padYTop;
        if (topY < 40) topY = 40;

        switch (color) {
            case 'RED': return { x: this.boardX + padX, y: this.boardY + boardSize + padYBottom };
            case 'GREEN': return { x: this.boardX + boardSize - padX, y: this.boardY + boardSize + padYBottom };
            case 'BLUE': return { x: this.boardX + padX, y: topY };
            case 'YELLOW': return { x: this.boardX + boardSize - padX, y: topY };
            default: return { x: this.cameras.main.centerX, y: this.boardY + boardSize + padYBottom };
        }
    }

    getColorHex(color, returnString = false) {
        const hexes = { RED: 0xff3333, BLUE: 0x0088ff, YELLOW: 0xffd700, GREEN: 0x00ee00 };
        const strings = { RED: '#ff3333', BLUE: '#0088ff', YELLOW: '#ffd700', GREEN: '#00ee00' };
        return returnString ? strings[color] : hexes[color];
    }
}

export class LudoLogic {
    constructor(activePlayers = ['RED', 'BLUE', 'YELLOW', 'GREEN'], gameVariation = 'CLASSIC') {
        this.activePlayers = activePlayers;
        this.gameVariation = gameVariation;
        this.turn = activePlayers[0];
        this.diceRoll = 0;
        this.consecutiveSixes = 0;
        this.gameState = 'WAITING_FOR_ROLL'; // WAITING_FOR_ROLL, WAITING_FOR_MOVE
        this.pieces = {
            RED: [0, 0, 0, 0], // 0 means in base
            BLUE: [0, 0, 0, 0],
            YELLOW: [0, 0, 0, 0],
            GREEN: [0, 0, 0, 0]
        };
        // Pity Timer tracking: consecutive rolls without getting a 6
        this.missedSixes = { RED: 0, BLUE: 0, YELLOW: 0, GREEN: 0 };
    }

    rollDice() {
        if (this.gameState !== 'WAITING_FOR_ROLL') return null;
        // Pity Timer Logic ("Proteção contra Má Sorte")
        // Base chance to roll 6 is ~16.6% (1/6). 
        // If a player misses 4 times in a row, the chance gradually increases up to 100% on the 10th attempt.
        const pityChances = [1/6, 1/6, 1/6, 1/6, 0.25, 0.35, 0.50, 0.70, 0.80, 1.0];
        const misses = Math.min(this.missedSixes[this.turn] || 0, 9);
        const chanceForSix = pityChances[misses];
        
        if (Math.random() <= chanceForSix) {
            this.diceRoll = 6;
        } else {
            // Roll between 1 and 5
            this.diceRoll = Math.floor(Math.random() * 5) + 1;
        }
        
        if (this.diceRoll === 6) {
            this.consecutiveSixes++;
            this.missedSixes[this.turn] = 0; // Reset pity timer on success
        } else {
            this.consecutiveSixes = 0;
            this.missedSixes[this.turn]++; // Increment missed sixes
        }

        this.gameState = 'WAITING_FOR_MOVE';
        
        return this.diceRoll;
    }

    getTeammate(color) {
        if (color === 'RED') return 'YELLOW';
        if (color === 'YELLOW') return 'RED';
        if (color === 'BLUE') return 'GREEN';
        if (color === 'GREEN') return 'BLUE';
        return null;
    }

    hasFinished(color) {
        return this.pieces[color].every(pos => pos === 57);
    }

    getEffectiveTurn() {
        if (this.gameVariation !== 'TEAM') return this.turn;
        if (this.hasFinished(this.turn)) {
            const teammate = this.getTeammate(this.turn);
            if (!this.hasFinished(teammate)) return teammate;
        }
        return this.turn;
    }

    canAnyPieceMove() {
        const effectiveColor = this.getEffectiveTurn();
        const playerPieces = this.pieces[effectiveColor];
        return playerPieces.some((_, index) => this.canMovePiece(index, effectiveColor));
    }

    canMovePiece(pieceIndex, forColor = this.getEffectiveTurn()) {
        if (this.consecutiveSixes >= 3) return false;
        const pos = this.pieces[forColor][pieceIndex];
        if (pos === 57) return false; // Already finished
        if (pos === 0) return this.diceRoll === 6;
        if (pos + this.diceRoll > 57) return false; // 52 common + 5 home
        return true;
    }

    movePiece(pieceIndex, forColor = this.getEffectiveTurn()) {
        if (this.gameState !== 'WAITING_FOR_MOVE' || !this.canMovePiece(pieceIndex, forColor)) return false;

        let currentPos = this.pieces[forColor][pieceIndex];
        const oldPos = currentPos;

        if (currentPos === 0) {
            this.pieces[forColor][pieceIndex] = 1; // Start
        } else {
            this.pieces[forColor][pieceIndex] += this.diceRoll;
        }

        const newPos = this.pieces[forColor][pieceIndex];
        const captureInfo = this.checkCaptures(forColor, newPos, true);
        const isChance = this.isChanceSquare(forColor, newPos);
        const getsExtraTurn = (this.diceRoll === 6 || captureInfo.length > 0 || newPos === 57);
        let shouldNextTurn = !getsExtraTurn;
        
        if (isChance) {
            shouldNextTurn = false; // suspend turning until chance card is applied
            this.gameState = 'DRAWING_CHANCE';
        } else if (getsExtraTurn) {
            this.gameState = 'WAITING_FOR_ROLL';
        }

        return {
            success: true,
            isChance: isChance,
            captured: captureInfo,
            extraTurn: getsExtraTurn,
            shouldNextTurn: shouldNextTurn, 
            oldPos: oldPos,
            newPos: newPos
        };
    }

    nextTurn() {
        this.turn = this.getNextTurn();
        this.consecutiveSixes = 0;
        this.gameState = 'WAITING_FOR_ROLL';
    }

    getNextTurn() {
        const playersOrder = ['RED', 'BLUE', 'YELLOW', 'GREEN'];
        let currentIndex = playersOrder.indexOf(this.turn);
        
        let safety = 0;
        while (safety < 10) {
            safety++;
            currentIndex = (currentIndex + 1) % 4;
            const nextColor = playersOrder[currentIndex];
            if (this.activePlayers && this.activePlayers.includes(nextColor)) {
                return nextColor;
            }
        }
        return this.turn;
    }

    checkCaptures(movingPlayer, pos, perform = true) {
        if (pos > 52) return []; // Cannot capture if in home stretch

        // Global safe positions (the ones drawn with arrows/stars in GameScene)
        // RED start=0, BLUE start=13, YELLOW start=26, GREEN start=39
        // Safe spots (visual stars/gray):
        // RED: 0 (start), 8 (safe) | BLUE: 13 (start), 21 (safe) | YELLOW: 26 (start), 34 (safe) | GREEN: 39 (start), 47 (safe)
        const safeGlobal = new Set([0, 8, 13, 21, 26, 34, 39, 47]); 
        const starts = { RED: 0, BLUE: 13, YELLOW: 26, GREEN: 39 };
        const movingGlobal = (starts[movingPlayer] + pos - 1) % 52;
        if (safeGlobal.has(movingGlobal)) return [];

        let captures = [];
        Object.keys(this.pieces).forEach(color => {
            if (color === movingPlayer) return;
            if (this.gameVariation === 'TEAM' && color === this.getTeammate(movingPlayer)) return; // Friendly fire disabled!

            this.pieces[color].forEach((otherPos, index) => {
                // If on path, check logic overlap
                if (otherPos > 0 && otherPos < 53 && this.isSameGlobalSquare(movingPlayer, pos, color, otherPos)) {
                    if (perform) {
                        this.pieces[color][index] = 0; // Send back to base
                    }
                    captures.push({ color, index });
                }
            });
        });
        return captures;
    }

    isChanceSquare(color, pos) {
        if (this.gameVariation !== 'LUCK') return false;
        if (pos <= 0 || pos > 51) return false; // Only global path
        const starts = { RED: 0, BLUE: 13, YELLOW: 26, GREEN: 39 };
        const globalPos = (starts[color] + pos - 1) % 52;
        // Interrogation marks at positions: 4, 11, 17, 24, 30, 37, 43, 50
        const CHANCE_SQUARES = new Set([4, 11, 17, 24, 30, 37, 43, 50]);
        return CHANCE_SQUARES.has(globalPos);
    }

    drawChanceCard() {
        const effects = [
            { id: 'FORWARD_3', label: 'AVANÇO RÁPIDO', desc: 'Vá +3 casas!' },
            { id: 'BACK_4', label: 'VENTO FORTE', desc: 'Volte 4 casas!' },
            { id: 'FORWARD_5', label: 'SALTO LONGO', desc: 'Avançar 5 casas!' },
            { id: 'BASE', label: 'AZAR EXTREMO', desc: 'Voltar para a base.' },
            { id: 'FORWARD_1', label: 'IMPULSO', desc: 'Vá +1 casa!' }
        ];
        return effects[Math.floor(Math.random() * effects.length)];
    }

    applyChanceEffect(color, index, effectId) {
        let pos = this.pieces[color][index];

        if (effectId === 'FORWARD_3') pos = Math.min(pos + 3, 57);
        if (effectId === 'FORWARD_5') pos = Math.min(pos + 5, 57);
        if (effectId === 'FORWARD_1') pos = Math.min(pos + 1, 57);
        if (effectId === 'BACK_4') pos = Math.max(pos - 4, 1);
        if (effectId === 'BASE') pos = 0;

        this.pieces[color][index] = pos;
        
        let captures = [];
        if (pos > 0 && pos < 57) {
            captures = this.checkCaptures(color, pos, true);
        }

        const extraTurn = captures.length > 0 || pos === 57;
        
        return { newPos: pos, captured: captures, extraTurn: extraTurn, shouldNextTurn: !extraTurn };
    }

    isSameGlobalSquare(p1, pos1, p2, pos2) {
        const starts = { RED: 0, BLUE: 13, YELLOW: 26, GREEN: 39 };
        const g1 = (starts[p1] + pos1 - 1) % 52;
        const g2 = (starts[p2] + pos2 - 1) % 52;
        return g1 === g2;
    }

    checkWinner() {
        if (this.gameVariation === 'TEAM') {
            const team1Won = this.hasFinished('RED') && this.hasFinished('YELLOW');
            const team2Won = this.hasFinished('BLUE') && this.hasFinished('GREEN');
            if (team1Won) return 'RED_TEAM'; // Identifier for Team 1
            if (team2Won) return 'BLUE_TEAM'; // Identifier for Team 2
            return null;
        }

        for (const color of ['RED', 'BLUE', 'YELLOW', 'GREEN']) {
            if (this.hasFinished(color)) {
                return color;
            }
        }
        return null;
    }
}

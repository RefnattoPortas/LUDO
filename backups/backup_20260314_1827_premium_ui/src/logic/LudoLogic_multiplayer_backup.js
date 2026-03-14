export class LudoLogic {
    constructor(activePlayers = ['RED', 'BLUE', 'YELLOW', 'GREEN']) {
        this.activePlayers = activePlayers;
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
    }

    rollDice() {
        if (this.gameState !== 'WAITING_FOR_ROLL') return null;
        this.diceRoll = Math.floor(Math.random() * 6) + 1;
        
        if (this.diceRoll === 6) {
            this.consecutiveSixes++;
        } else {
            this.consecutiveSixes = 0;
        }

        this.gameState = 'WAITING_FOR_MOVE';
        
        return this.diceRoll;
    }

    canAnyPieceMove() {
        const playerPieces = this.pieces[this.turn];
        return playerPieces.some((pos, index) => this.canMovePiece(index));
    }

    canMovePiece(pieceIndex) {
        if (this.consecutiveSixes >= 3) return false;
        const pos = this.pieces[this.turn][pieceIndex];
        if (pos === 57) return false; // Already finished
        if (pos === 0) return this.diceRoll === 6;
        if (pos + this.diceRoll > 57) return false; // 52 common + 5 home
        return true;
    }

    movePiece(pieceIndex) {
        if (this.gameState !== 'WAITING_FOR_MOVE' || !this.canMovePiece(pieceIndex)) return false;

        let currentPos = this.pieces[this.turn][pieceIndex];
        const oldPos = currentPos;

        if (currentPos === 0) {
            this.pieces[this.turn][pieceIndex] = 1; // Start
        } else {
            this.pieces[this.turn][pieceIndex] += this.diceRoll;
        }

        const newPos = this.pieces[this.turn][pieceIndex];
        const captureInfo = this.checkCaptures(this.turn, newPos, true);
        const getsExtraTurn = (this.diceRoll === 6 || captureInfo.length > 0 || newPos === 57);

        if (!getsExtraTurn) {
            this.nextTurn();
        } else {
            this.gameState = 'WAITING_FOR_ROLL';
        }

        return {
            success: true,
            captured: captureInfo,
            extraTurn: getsExtraTurn,
            oldPos: oldPos,
            newPos: newPos
        };
    }

    nextTurn() {
        this.consecutiveSixes = 0;
        const playersOrder = ['RED', 'BLUE', 'YELLOW', 'GREEN'];
        let currentIndex = playersOrder.indexOf(this.turn);
        
        let safety = 0;
        while (safety < 10) {
            safety++;
            currentIndex = (currentIndex + 1) % 4;
            const nextColor = playersOrder[currentIndex];
            if (this.activePlayers && this.activePlayers.includes(nextColor)) {
                this.turn = nextColor;
                break;
            }
        }
        
        this.gameState = 'WAITING_FOR_ROLL';
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

    isSameGlobalSquare(p1, pos1, p2, pos2) {
        const starts = { RED: 0, BLUE: 13, YELLOW: 26, GREEN: 39 };
        const g1 = (starts[p1] + pos1 - 1) % 52;
        const g2 = (starts[p2] + pos2 - 1) % 52;
        return g1 === g2;
    }

    checkWinner() {
        for (const color of ['RED', 'BLUE', 'YELLOW', 'GREEN']) {
            if (this.pieces[color].every(pos => pos === 57)) {
                return color;
            }
        }
        return null;
    }
}

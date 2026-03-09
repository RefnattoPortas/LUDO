export class LudoLogic {
    constructor() {
        this.turn = 'RED';
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
        const players = ['RED', 'BLUE', 'YELLOW', 'GREEN'];
        const currentIndex = players.indexOf(this.turn);
        this.turn = players[(currentIndex + 1) % 4];
        this.gameState = 'WAITING_FOR_ROLL';
    }

    checkCaptures(movingPlayer, pos, perform = true) {
        if (pos > 52) return []; // Cannot capture if in home stretch

        // Fixed safe positions (starts) + visual safe squares (5 houses before each exit)
        // Global positions 47 = 5 before RED exit (global 52)
        // Detected by: global = (start + pos - 1) % 52
        // RED start=0: global47 → pos=48 | BLUE start=13: global47 → pos=35 | YELLOW start=26: pos=22 | GREEN start=39: pos=9
        const safeGlobal = new Set([0, 13, 26, 39, 47]); // starts + 5-before-exit global
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
}

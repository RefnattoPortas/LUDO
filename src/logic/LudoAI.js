export class LudoAI {
    /**
     * @param {LudoLogic} logic The game logic instance
     */
    constructor(logic) {
        this.logic = logic;
    }

    /**
     * Decides Which piece to move based on a "Greedy" strategy
     * @param {string} color The player color
     * @param {number} roll The dice roll
     * @returns {number|null} The index of the piece to move (0-3)
     */
    decideMove(color, roll) {
        const moves = [];
        const effectiveColor = this.logic.getEffectiveTurn();
        const pieces = this.logic.pieces[effectiveColor];

        pieces.forEach((pos, index) => {
            if (this.logic.canMovePiece(index, effectiveColor)) {
                const score = this.calculateMoveScore(effectiveColor, index, pos, roll);
                moves.push({ index, score });
            }
        });

        if (moves.length === 0) return null;

        // Sort by score descending
        moves.sort((a, b) => b.score - a.score);
        return moves[0].index;
    }

    calculateMoveScore(color, index, currentPos, roll) {
        let score = 0;
        const newPos = (currentPos === 0) ? 1 : currentPos + roll;

        // 1. Priority: Capturing an opponent (The "Greedy" part)
        const captures = this.logic.checkCaptures(color, newPos, false);
        if (captures && captures.length > 0) {
            score += 1000;
        }

        // 2. Priority: Getting out of base (if 6)
        if (currentPos === 0 && roll === 6) {
            score += 500;
        }

        // 3. Priority: Moving a piece into the home path (safe zone)
        if (newPos > 52) {
            score += 300;
        }

        // 4. Priority: Moving pieces that are already further ahead
        score += newPos * 2;

        // 5. Caution: Avoid landing on a spot that might be captured (optional/future)
        
        return score;
    }
}

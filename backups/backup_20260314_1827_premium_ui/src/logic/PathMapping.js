
/**
 * Maps a logical position to grid coordinates (15x15)
 * @param {string} color RED, BLUE, YELLOW, GREEN
 * @param {number} position 0 (base), 1-52 (caminho comum), 53-58 (casa final)
 */
export function getCoordinates(color, position, pieceIndex = 0) {
    if (position === 0) return getBaseCoordinates(color, pieceIndex);
    
    if (position > 51) {
        return getHomeCoordinates(color, position);
    }
    
    // Normalizing position to the global path
    const globalPath = getGlobalPath(color);
    const cellIndex = globalPath[position - 1];
    
    return mapCellToGrid(cellIndex);
}

function getHomeCoordinates(color, position) {
    const step = position - 51; // 1 to 6
    if (color === 'RED') return { x: 7, y: 14 - step };
    if (color === 'BLUE') return { x: step, y: 7 };
    if (color === 'YELLOW') return { x: 7, y: step };
    if (color === 'GREEN') return { x: 14 - step, y: 7 };
    return { x: 7, y: 7 };
}

function getGlobalPath(color) {
    const starts = { RED: 0, BLUE: 13, YELLOW: 26, GREEN: 39 };
    const start = starts[color];
    const path = [];
    for (let i = 0; i < 52; i++) {
        path.push((start + i) % 52);
    }
    return path;
}

function mapCellToGrid(index) {
    // This is the tricky part: mapping the cross shape of Ludo to a 15x15 grid
    if (index >= 0 && index <= 4) return { x: 6, y: 13 - index };
    if (index >= 5 && index <= 10) return { x: 5 - (index - 5), y: 8 };
    if (index === 11) return { x: 0, y: 7 };
    if (index >= 12 && index <= 17) return { x: index - 12, y: 6 };
    if (index >= 18 && index <= 23) return { x: 6, y: 5 - (index - 18) };
    if (index === 24) return { x: 7, y: 0 };
    if (index >= 25 && index <= 30) return { x: 8, y: index - 25 };
    if (index >= 31 && index <= 36) return { x: 9 + (index - 31), y: 6 };
    if (index === 37) return { x: 14, y: 7 };
    if (index >= 38 && index <= 43) return { x: 14 - (index - 38), y: 8 };
    if (index >= 44 && index <= 49) return { x: 8, y: 9 + (index - 44) };
    if (index === 50) return { x: 7, y: 14 };
    if (index === 51) return { x: 6, y: 14 };

    return { x: 7, y: 7 }; // Center
}

function getBaseCoordinates(color, pieceIndex) {
    const bases = {
        RED: { x: 2.5, y: 11.5 },
        BLUE: { x: 2.5, y: 2.5 },
        YELLOW: { x: 11.5, y: 2.5 },
        GREEN: { x: 11.5, y: 11.5 }
    };
    
    const base = bases[color];
    const offsets = [
        { dx: -1, dy: -1 },
        { dx: 1, dy: -1 },
        { dx: -1, dy: 1 },
        { dx: 1, dy: 1 }
    ];
    
    return {
        x: base.x + offsets[pieceIndex].dx,
        y: base.y + offsets[pieceIndex].dy
    };
}

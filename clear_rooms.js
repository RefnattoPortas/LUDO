import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://ebujbtckuqiidxdnjpgl.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_ZgG1kV-reMXnCClN6eW1bw_Wp93APF4';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function clearRooms() {
    console.log('Clearing all players from ludo_players...');
    const { data: playersData, error: playersError } = await supabase
        .from('ludo_players')
        .delete()
        .neq('color', 'NONE'); // Hack to delete all rows

    if (playersError) {
        console.error('Error deleting players:', playersError);
    } else {
        console.log('Players cleared.');
    }

    console.log('Resetting game states...');
    const { data: gameStateData, error: gameStateError } = await supabase
        .from('ludo_game_state')
        .delete()
        .neq('room_id', 0);
        
    if (gameStateError) {
        console.error('Error resetting game state:', gameStateError);
    } else {
        console.log('Game states cleared.');
    }
    
    console.log('Done!');
}

clearRooms();

import { supabase } from '../supabase';

export class LudoOnline {
    constructor(roomId, onStateUpdate) {
        this.roomId = roomId;
        this.onStateUpdate = onStateUpdate;
        this.channel = null;
        this.subscription = null;
    }

    async joinRoom(color) {
        // 1. Update player in ludo_players (already inserted by LobbyScene)
        const { error } = await supabase
            .from('ludo_players')
            .update({ last_active: new Date() })
            .match({ room_id: this.roomId, color });
        
        if (error) console.warn('Supabase player update error:', error);

        // 2. Subscribe to REALTIME game_state changes
        this.subscription = supabase
            .channel(`room_${this.roomId}`)
            .on('postgres_changes', { 
                event: 'UPDATE', 
                schema: 'public', 
                table: 'ludo_game_state', 
                filter: `room_id=eq.${this.roomId}` 
            }, payload => {
                this.onStateUpdate(payload.new);
            })
            .subscribe();

        // 3. Get initial state
        const { data: stateData } = await supabase
            .from('ludo_game_state')
            .select('*')
            .eq('room_id', this.roomId)
            .single();
        
        if (stateData) {
            this.onStateUpdate(stateData);
        } else {
            // If it doesn't exist, initialize it
            await this.initializeGameState();
        }
    }

    async initializeGameState() {
        await supabase.from('ludo_game_state').upsert({
            room_id: this.roomId,
            current_turn: 'RED',
            last_dice_roll: 0,
            pieces: { RED: [0, 0, 0, 0], BLUE: [0, 0, 0, 0], YELLOW: [0, 0, 0, 0], GREEN: [0, 0, 0, 0] }
        });
    }

    async updateGame(turn, roll, pieces) {
        await supabase
            .from('ludo_game_state')
            .update({ current_turn: turn, last_dice_roll: roll, pieces, updated_at: new Date() })
            .eq('room_id', this.roomId);
    }

    async leaveRoom(color) {
        if (color) {
            await supabase
                .from('ludo_players')
                .delete()
                .match({ room_id: this.roomId, color });
        }
        if (this.subscription) supabase.removeChannel(this.subscription);
    }
}

import { supabase } from '../supabase';

export class LudoOnline {
    constructor(roomId, onStateUpdate) {
        this.roomId = roomId;
        this.onStateUpdate = onStateUpdate;
        this.channel = null;
        this.subscription = null;
    }

    async joinRoom(color, activePlayers = ['RED', 'BLUE', 'YELLOW', 'GREEN'], forceReset = false) {
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
            // Validate if state is fresh or if we specifically requested a reset
            // Initialization is forced if:
            // - forceReset is true (new match from lobby)
            // - OR current_turn is invalid for this room (stale state)
            if (forceReset || !activePlayers.includes(stateData.current_turn)) {
                console.log('Resetting/Re-initializing game state...');
                await this.initializeGameState(activePlayers[0]);
            } else {
                // If it's a join but not my turn, just let the Realtime update handle it or call update directly
                this.onStateUpdate(stateData);
            }
        } else {
            // If it doesn't exist, initialize it
            await this.initializeGameState(activePlayers[0]);
        }
    }

    async initializeGameState(firstTurn) {
        // Fetch current to avoid race conditions if needed, but upsert is fine here
        const initialState = {
            room_id: this.roomId,
            current_turn: firstTurn || 'RED',
            last_dice_roll: 0,
            pieces: { RED: [0, 0, 0, 0], BLUE: [0, 0, 0, 0], YELLOW: [0, 0, 0, 0], GREEN: [0, 0, 0, 0] },
            updated_at: new Date()
        };
        await supabase.from('ludo_game_state').upsert(initialState);
        this.onStateUpdate(initialState); // Trigger local sync immediately
    }

    async updateGame(turn, roll, pieces) {
        await supabase
            .from('ludo_game_state')
            .update({ 
                current_turn: turn, 
                last_dice_roll: roll, 
                pieces, 
                updated_at: new Date() 
            })
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

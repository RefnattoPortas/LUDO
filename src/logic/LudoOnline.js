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

        // 2. Subscribe to REALTIME changes (Postgres + Broadcast)
        this.subscription = supabase.channel(`room_${this.roomId}`);
        
        this.subscription
            .on('postgres_changes', { 
                event: 'UPDATE', 
                schema: 'public', 
                table: 'ludo_game_state', 
                filter: `room_id=eq.${this.roomId}` 
            }, payload => {
                // Persistent DB update (Backup)
                this.onStateUpdate(payload.new, 'DB');
            })
            .on('broadcast', { event: 'game_update' }, payload => {
                // Fast Broadcast update (Sub-100ms)
                this.onStateUpdate(payload.payload, 'BROADCAST');
            })
            .subscribe();

        // 3. Get initial state
        const { data: stateData } = await supabase
            .from('ludo_game_state')
            .select('*')
            .eq('room_id', this.roomId)
            .single();
        
        if (stateData) {
            if (!stateData.updated_at) stateData.updated_at = new Date().toISOString();
            if (forceReset || !activePlayers.includes(stateData.current_turn)) {
                console.log('Resetting/Re-initializing game state...');
                await this.initializeGameState(activePlayers[0]);
            } else {
                this.onStateUpdate(stateData, 'INITIAL');
            }
        } else {
            await this.initializeGameState(activePlayers[0]);
        }
    }

    async initializeGameState(firstTurn) {
        const initialState = {
            room_id: this.roomId,
            current_turn: firstTurn || 'RED',
            last_dice_roll: 0,
            pieces: { RED: [0, 0, 0, 0], BLUE: [0, 0, 0, 0], YELLOW: [0, 0, 0, 0], GREEN: [0, 0, 0, 0] },
            updated_at: new Date().toISOString()
        };
        await supabase.from('ludo_game_state').upsert(initialState);
        this.onStateUpdate(initialState, 'INITIAL');
    }

    async updateGame(turn, roll, pieces) {
        const payload = { 
            room_id: this.roomId,
            current_turn: turn, 
            last_dice_roll: roll, 
            pieces, 
            updated_at: new Date().toISOString()
        };

        // 1. Instant sync via Broadcast
        if (this.subscription) {
            this.subscription.send({
                type: 'broadcast',
                event: 'game_update',
                payload: payload
            });
        }

        // 2. Persistent update via DB
        await supabase
            .from('ludo_game_state')
            .update(payload)
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

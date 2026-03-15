import { supabase } from '../supabase';

export class LudoOnline {
    constructor(roomId, onStateUpdate) {
        this.roomId = roomId;
        this.onStateUpdate = onStateUpdate;
        this.channel = null;
        this.subscription = null;
    }

    async joinRoom(color) {
        // 1. Insert player into ludo_players
        const { data, error } = await supabase
            .from('ludo_players')
            .upsert(
                { room_id: this.roomId, color, last_active: new Date() },
                { onConflict: 'room_id,color' }
            )
            .select();
        
        if (error) throw error;

        // 2. Subscribe to REALTIME game_state changes
        this.subscribeToRoom();

        // 3. Get initial state
        await this.syncWithServer();
    }

    async syncWithServer() {
        if (!this.roomId) return;
        const { data: stateData, error } = await supabase
            .from('ludo_game_state')
            .select('*')
            .eq('room_id', Number(this.roomId))
            .maybeSingle();
        
        if (error) {
            console.error("[LudoOnline] Sync error:", error);
            return;
        }

        if (stateData) {
            this.onStateUpdate(stateData);
        } else {
            await this.initializeGameState();
            this.onStateUpdate({
                current_turn: 'RED',
                last_dice_roll: 0,
                pieces: { RED: [0, 0, 0, 0], BLUE: [0, 0, 0, 0], YELLOW: [0, 0, 0, 0], GREEN: [0, 0, 0, 0] }
            });
        }
    }

    subscribeToRoom() {
        if (this.subscription) {
            supabase.removeChannel(this.subscription);
        }

        this.subscription = supabase
            .channel(`room_sync_${this.roomId}_${Date.now()}`)
            .on('postgres_changes', { 
                event: 'UPDATE', 
                schema: 'public', 
                table: 'ludo_game_state',
                filter: `room_id=eq.${Number(this.roomId)}`
            }, payload => {
                if (payload.new) {
                    console.log(`[LudoOnline] Realtime update for room ${this.roomId}`);
                    this.onStateUpdate(payload.new);
                }
            })
            .subscribe((status) => {
                console.log(`[RealtimeStatus] Room ${this.roomId}: ${status}`);
                if (status === 'CHANNEL_ERROR' || status === 'CLOSED') {
                    // Auto-reconnect after 3 seconds if connection fails
                    setTimeout(() => this.subscribeToRoom(), 3000);
                }
            });
    }

    async initializeGameState() {
        const { error } = await supabase.from('ludo_game_state').upsert({
            room_id: Number(this.roomId),
            current_turn: 'RED',
            last_dice_roll: 0,
            pieces: { RED: [0, 0, 0, 0], BLUE: [0, 0, 0, 0], YELLOW: [0, 0, 0, 0], GREEN: [0, 0, 0, 0] },
            updated_at: new Date().toISOString()
        }, { onConflict: 'room_id' });
        
        if (error) console.error("[LudoOnline] Error initializing state:", error);
    }

    async updateGame(turn, roll, pieces) {
        if (!this.roomId) return;
        
        const { error } = await supabase
            .from('ludo_game_state')
            .update({ 
                current_turn: turn, 
                last_dice_roll: roll, 
                pieces: pieces,
                updated_at: new Date().toISOString() 
            })
            .eq('room_id', Number(this.roomId));
            
        if (error) console.error("[LudoOnline] Update Error:", error);
    }

    async leaveRoom(color) {
        console.log(`[LudoOnline] Leaving room ${this.roomId}`);
        if (color) {
            try {
                await supabase
                    .from('ludo_players')
                    .delete()
                    .match({ room_id: Number(this.roomId), color: color });
            } catch (e) {}
        }
        if (this.subscription) {
            supabase.removeChannel(this.subscription);
            this.subscription = null;
        }
    }
}

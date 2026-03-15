import Phaser from 'phaser';
import { supabase } from '../supabase';

export class LobbyScene extends Phaser.Scene {
    constructor() {
        super('LobbyScene');
    }

    preload() {
        this.load.image('lobby_bg', '/lobby_bg.png');
    }

    async create() {
        const cx = this.cameras.main.centerX;
        const cy = this.cameras.main.centerY;
        const W = this.cameras.main.width;
        const H = this.cameras.main.height;

        this.joinedRoom = null;
        this.myColor = null;

        // Background
        const bg = this.add.image(cx, cy, 'lobby_bg').setDepth(-2);
        bg.setScale(Math.max(W / bg.width, H / bg.height) || 1);

        // Dark overlay
        this.add.rectangle(0, 0, W, H, 0x000000, 0.65).setOrigin(0).setDepth(-1);

        // Back button
        this.backBtn = this.add.text(30, 30, '← Voltar', {
            fontSize: '17px', fontFamily: 'Arial', fill: '#ffffff',
            backgroundColor: '#333333', padding: { x: 10, y: 6 }
        })
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => this.leaveAndBack());

        // Title
        this.titleText = this.add.text(cx, 80, 'Multiplayer Online', {
            fontSize: '40px', fontFamily: 'Arial Black, Arial', fontWeight: 'bold', fill: '#ffffff',
            shadow: { offsetX: 2, offsetY: 3, color: '#000', blur: 8, fill: true }
        }).setOrigin(0.5);

        this.instructionText = this.add.text(cx, 135, 'Escolha o modo de jogo', {
            fontSize: '18px', fontFamily: 'Arial', fill: '#aaaaaa'
        }).setOrigin(0.5);

        // Create Room Cards (Vertical List)
        this.createAddButtons(cx, 170);

        // Waiting Overlay (hidden by default)
        this.createWaitingOverlay(cx, cy, W, H);
    }

    createAddButtons(x, y) {
        const gapY = 90;
        this.createModernCard(x, y, "DUELO (2 Jog)", "Clássico", 0x4CAF50, () => this.findOrCreateAndJoin(2, 'CLASSIC'));
        this.createModernCard(x, y + gapY, "COMPLETA (4)", "Clássico", 0x2196F3, () => this.findOrCreateAndJoin(4, 'CLASSIC'));
        this.createModernCard(x, y + gapY * 2, "SORTE/AZAR (2)", "Cartas", 0xFF9800, () => this.findOrCreateAndJoin(2, 'LUCK'));
        this.createModernCard(x, y + gapY * 3, "SORTE/AZAR (4)", "Cartas", 0xFF9800, () => this.findOrCreateAndJoin(4, 'LUCK'));
        this.createModernCard(x, y + gapY * 4, "DUPLAS (4 Jog)", "Time vs Time", 0x9C27B0, () => this.findOrCreateAndJoin(4, 'TEAM'));
        this.createModernCard(x, y + gapY * 5, "2 HUM VS 2 I.A.", "Parceria vs Robôs", 0xE91E63, () => this.findOrCreateAndJoin(2, 'TEAM_AI'));
    }

    createModernCard(x, y, title, subtitle, color, callback) {
        const container = this.add.container(x, y);
        const w = 304, h = 80; // Reduced from 380 (20%)

        // Glass background
        const bg = this.add.graphics();
        bg.fillStyle(0x1a1a2e, 0.85);
        bg.fillRoundedRect(-w/2, -h/2, w, h, 14);
        
        // Neon edge
        const edge = this.add.graphics();
        edge.lineStyle(2, color, 1);
        edge.strokeRoundedRect(-w/2, -h/2, w, h, 14);

        // Icon Area
        const iconBg = this.add.graphics();
        iconBg.fillStyle(color, 0.2);
        iconBg.fillRoundedRect(-w/2 + 15, -h/2 + 15, 50, 50, 10);
        
        // Simple Icon (Dots)
        const dots = this.add.graphics();
        dots.fillStyle(color, 1);
        if (title.includes("2")) {
            dots.fillCircle(-w/2 + 30, -h/2 + 40, 6);
            dots.fillCircle(-w/2 + 50, -h/2 + 40, 6);
        } else {
            dots.fillCircle(-w/2 + 30, -h/2 + 30, 5);
            dots.fillCircle(-w/2 + 50, -h/2 + 30, 5);
            dots.fillCircle(-w/2 + 30, -h/2 + 50, 5);
            dots.fillCircle(-w/2 + 50, -h/2 + 50, 5);
        }

        const titleTxt = this.add.text(-w/2 + 85, -h/2 + 16, title, {
            fontSize: '20px', fontFamily: 'Arial Black', fill: '#ffffff'
        });

        const subTxt = this.add.text(-w/2 + 85, -h/2 + 44, subtitle, {
            fontSize: '15px', fontFamily: 'Arial', fill: '#aaaaaa'
        });

        container.add([bg, edge, iconBg, dots, titleTxt, subTxt]);
        
        container.setInteractive(new Phaser.Geom.Rectangle(-w/2, -h/2, w, h), Phaser.Geom.Rectangle.Contains, { useHandCursor: true });
        
        container.on('pointerdown', callback);
        container.on('pointerover', () => {
            this.tweens.add({ targets: container, scale: 1.03, duration: 150 });
            edge.clear().lineStyle(3, color, 1).strokeRoundedRect(-w/2, -h/2, w, h, 14);
        });
        container.on('pointerout', () => {
            this.tweens.add({ targets: container, scale: 1, duration: 150 });
            edge.clear().lineStyle(2, color, 0.6).strokeRoundedRect(-w/2, -h/2, w, h, 14);
        });

        return container;
    }

    createSmallButton(x, y, label, color, callback) {
        const container = this.add.container(x, y);
        const bg = this.add.graphics();
        bg.fillStyle(color, 1);
        bg.fillRoundedRect(-75, -20, 150, 40, 10);
        bg.lineStyle(2, 0xffffff, 0.5);
        bg.strokeRoundedRect(-75, -20, 150, 40, 10);
        
        const txt = this.add.text(0, 0, label, {
            fontSize: '14px', fontFamily: 'Arial Black', fill: '#fff'
        }).setOrigin(0.5);
        
        container.add([bg, txt]);
        container.setInteractive(new Phaser.Geom.Rectangle(-75, -20, 150, 40), Phaser.Geom.Rectangle.Contains, { useHandCursor: true });
        container.on('pointerdown', callback);
        return container;
    }

    async findOrCreateAndJoin(maxPlayers, variation = 'CLASSIC') {
        this.instructionText.setText("Buscando sala...");
        
        let nameSuffix = '';
        if (variation === 'TEAM') nameSuffix = ' | DUPLAS';
        if (variation === 'TEAM_AI') nameSuffix = ' | HUM vs IA';
        if (variation === 'LUCK') nameSuffix = ' | SORTE/AZAR';

        // 1. Try to find an existing WAITING room that is not full
        const { data: rooms, error } = await supabase
            .from('ludo_rooms')
            .select(`*, ludo_players (id)`)
            .eq('max_players', maxPlayers)
            .eq('status', 'LIVRE')
            .order('created_at', { ascending: true });

        let targetRoom = null;
        
        if (rooms && rooms.length > 0) {
            // Find the first room with available slots
            targetRoom = rooms.find(r => (r.ludo_players?.length || 0) < maxPlayers && r.name.includes(nameSuffix));
        }

        // 2. If no room found, create a new one
        if (!targetRoom) {
            const roomName = `Partida ${maxPlayers} Jogadores${nameSuffix}`;
            const { data: newRoom, error: createError } = await supabase
                .from('ludo_rooms')
                .insert({
                    name: roomName,
                    max_players: maxPlayers,
                    status: 'LIVRE'
                })
                .select()
                .single();
            
            if (createError) {
                console.error("Erro ao criar sala:", createError);
                this.instructionText.setText("Erro ao criar sala");
                return;
            }
            targetRoom = newRoom;
        }

        // 3. Join the room
        await this.joinRoom(targetRoom);
    }

    async joinRoom(room) {
        const { data: existingPlayers } = await supabase
            .from('ludo_players')
            .select('color')
            .eq('room_id', room.id);
        
        const takenColors = existingPlayers?.map(p => p.color) || [];
        
        // Custom Rule: If 2 players, use RED and YELLOW
        let availableColors = ['RED', 'BLUE', 'YELLOW', 'GREEN'];
        if (room.max_players === 2) {
            // In TEAM_AI, the two humans are RED and YELLOW
            availableColors = ['RED', 'YELLOW'];
        }

        this.myColor = availableColors.find(c => !takenColors.includes(c));

        if (!this.myColor) {
            // This might happen if someone joined just before us
            this.findOrCreateAndJoin(room.max_players);
            return;
        }

        // Join using upsert to handle accidental double entry (refresh)
        const { error } = await supabase.from('ludo_players').upsert({
            room_id: room.id,
            color: this.myColor,
            last_active: new Date()
        }, { onConflict: 'room_id,color' });

        if (error) {
            console.error("Lobby Join Error:", error);
            // If already full by the time we inserted, we might get an error here or later
        }

        this.joinedRoom = room;
        this.waitingOverlay.setVisible(true);
        this.roomsContainer?.setVisible(false); // Safety check if roomsContainer exists

        // Add Realtime subscription to see others joining
        if (this.roomChannel) supabase.removeChannel(this.roomChannel);
        
        this.roomChannel = supabase.channel(`lobby_${room.id}`)
            .on('postgres_changes', { 
                event: '*', 
                schema: 'public', 
                table: 'ludo_players', 
                filter: `room_id=eq.${room.id}` 
            }, () => {
                this.onPlayerUpdate();
            })
            .subscribe();

        this.onPlayerUpdate();
    }

    async onPlayerUpdate() {
        if (!this.sys || !this.sys.isActive()) return;
        if (!this.joinedRoom) return;

        // Check current room players
        const { data: players } = await supabase
            .from('ludo_players')
            .select('color')
            .eq('room_id', this.joinedRoom.id);
        
        const count = players?.length || 0;
        if (this.waitingStatus) {
            this.waitingStatus.setText(`Jogadores: ${count}/${this.joinedRoom.max_players}`);
        }

        if (count >= this.joinedRoom.max_players) {
            if (this.waitingTitle) this.waitingTitle.setText('SALA CHEIA!');
            if (this.waitingStatus) this.waitingStatus.setText('Iniciando partida...');
            
            // Get all players colors and sort them to maintain consistent turn order
            const colors = players.map(p => p.color);
            const orderedColors = ['RED', 'BLUE', 'YELLOW', 'GREEN'].filter(c => colors.includes(c));
            
            // Optional: Update room status so no more people try to join
            await supabase.from('ludo_rooms').update({ status: 'EM JOGO' }).eq('id', this.joinedRoom.id);

            this.time.delayedCall(1500, () => {
                this.startGame(orderedColors);
            });
        }
    }

    async leaveRoom() {
        if (this.joinedRoom && this.myColor) {
            await supabase
                .from('ludo_players')
                .delete()
                .match({ room_id: this.joinedRoom.id, color: this.myColor });
        if (this.roomChannel) {
            supabase.removeChannel(this.roomChannel);
            this.roomChannel = null;
        }
        this.joinedRoom = null;
        this.myColor = null;
        this.waitingOverlay.setVisible(false);
        if (this.roomsContainer) this.roomsContainer.setVisible(true);
        this.instructionText.setText('Escolha o modo de jogo');
    }

    leaveAndBack() {
        this.leaveRoom();
        this.scene.start('MenuScene');
    }

    startGame(activePlayers) {
        if (!this.joinedRoom) return;

        let variation = 'CLASSIC';
        if (this.joinedRoom.name.includes('DUPLAS')) variation = 'TEAM';
        if (this.joinedRoom.name.includes('HUM vs IA')) variation = 'TEAM_AI';
        if (this.joinedRoom.name.includes('SORTE')) variation = 'LUCK';

        this.cameras.main.fadeOut(300, 0, 0, 0);
        this.cameras.main.once('camerafadeoutcomplete', () => {
            this.scene.start('GameScene', {
                mode: 'ONLINE',
                roomId: this.joinedRoom.id,
                playerColor: this.myColor,
                activePlayers: activePlayers,
                gameVariation: variation
            });
        });
    }

    createWaitingOverlay(cx, cy, W, H) {
        this.waitingOverlay = this.add.container(0, 0).setDepth(200).setVisible(false);

        // Semi-transparent background
        const bg = this.add.rectangle(0, 0, W, H, 0x000000, 0.85).setOrigin(0);
        
        // Panel
        const panelW = 400, panelH = 300;
        const panel = this.add.graphics();
        panel.fillStyle(0x1a1a2e, 1);
        panel.fillRoundedRect(cx - panelW/2, cy - panelH/2, panelW, panelH, 20);
        panel.lineStyle(3, 0x2196F3, 1);
        panel.strokeRoundedRect(cx - panelW/2, cy - panelH/2, panelW, panelH, 20);

        // Animated Spinner (Circle)
        const spinner = this.add.graphics();
        spinner.lineStyle(4, 0x2196F3, 1);
        spinner.strokeCircle(cx, cy - 40, 30);
        this.tweens.add({
            targets: spinner,
            angle: 360,
            duration: 2000,
            repeat: -1
        });

        this.waitingTitle = this.add.text(cx, cy + 30, 'PROCURANDO JOGADORES', {
            fontSize: '22px', fontFamily: 'Arial Black', fill: '#ffffff'
        }).setOrigin(0.5);

        this.waitingStatus = this.add.text(cx, cy + 70, 'Aguardando oponentes...', {
            fontSize: '16px', fontFamily: 'Arial', fill: '#aaaaaa'
        }).setOrigin(0.5);

        const cancelBtn = this.add.text(cx, cy + 120, 'CANCELAR', {
            fontSize: '14px', fontFamily: 'Arial Black', fill: '#ff5555',
            backgroundColor: '#222', padding: { x: 20, y: 10 }
        })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => this.leaveRoom());

        this.waitingOverlay.add([bg, panel, spinner, this.waitingTitle, this.waitingStatus, cancelBtn]);
    }

    shutdown() {
        if (this.roomChannel) supabase.removeChannel(this.roomChannel);
    }
}


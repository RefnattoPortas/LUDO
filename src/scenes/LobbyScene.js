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
        this.createAddButtons(cx, 180);

        this.roomsContainer = this.add.container(cx, 400);

        // Waiting Overlay (hidden by default)
        this.createWaitingOverlay(cx, cy, W, H);

        // Initial fetch
        this.refreshRoomList();
        this.time.addEvent({ delay: 5000, callback: () => this.refreshRoomList(), loop: true });

        // Subscribe to room updates (Realtime)
        this.roomChannel = supabase
            .channel('lobby_rooms')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'ludo_rooms' }, () => this.refreshRoomList())
            .on('postgres_changes', { event: '*', schema: 'public', table: 'ludo_players' }, () => this.onPlayerUpdate())
            .subscribe((status) => console.log(`[LobbyRealtime] Status: ${status}`));

        this.events.once('shutdown', () => {
            if (this.roomChannel) {
                supabase.removeChannel(this.roomChannel);
                this.roomChannel = null;
            }
        });
    }

    createAddButtons(x, y) {
        const gapX = 195;
        const gapY = 70;
        this.createModernCard(x - gapX, y, "DUELO (2 Jog)", "Clássico", 0x4CAF50, () => this.findOrCreateAndJoin(2, 'CLASSIC'));
        this.createModernCard(x + gapX, y, "COMPLETA (4)", "Clássico", 0x2196F3, () => this.findOrCreateAndJoin(4, 'CLASSIC'));
        this.createModernCard(x - gapX, y + gapY, "SORTE/AZAR (2)", "Cartas", 0xFF9800, () => this.findOrCreateAndJoin(2, 'LUCK'));
        this.createModernCard(x + gapX, y + gapY, "SORTE/AZAR (4)", "Cartas", 0xFF9800, () => this.findOrCreateAndJoin(4, 'LUCK'));
        this.createModernCard(x - gapX, y + gapY * 2, "DUPLAS (4 Jog)", "Time vs Time", 0x9C27B0, () => this.findOrCreateAndJoin(4, 'TEAM'));
    }

    createModernCard(x, y, title, subtitle, color, callback) {
        const container = this.add.container(x, y);
        const w = 360, h = 60;

        // Glass background
        const bg = this.add.graphics();
        bg.fillStyle(0x1a1a2e, 0.8);
        bg.fillRoundedRect(-w/2, -h/2, w, h, 12);
        
        // Neon edge
        const edge = this.add.graphics();
        edge.lineStyle(2, color, 1);
        edge.strokeRoundedRect(-w/2, -h/2, w, h, 12);

        // Icon Area
        const iconBg = this.add.graphics();
        iconBg.fillStyle(color, 0.2);
        iconBg.fillRoundedRect(-w/2 + 10, -h/2 + 10, 50, 50, 8);
        
        // Simple Icon (Dots)
        const dots = this.add.graphics();
        dots.fillStyle(color, 1);
        if (title.includes("2")) {
            dots.fillCircle(-w/2 + 25, -h/2 + 30, 6);
            dots.fillCircle(-w/2 + 45, -h/2 + 30, 6);
        } else {
            dots.fillCircle(-w/2 + 25, -h/2 + 20, 5);
            dots.fillCircle(-w/2 + 45, -h/2 + 20, 5);
            dots.fillCircle(-w/2 + 25, -h/2 + 40, 5);
            dots.fillCircle(-w/2 + 45, -h/2 + 40, 5);
        }

        const titleTxt = this.add.text(-w/2 + 75, -h/2 + 10, title, {
            fontSize: '18px', fontFamily: 'Arial Black', fill: '#ffffff'
        });

        const subTxt = this.add.text(-w/2 + 75, -h/2 + 40, subtitle, {
            fontSize: '13px', fontFamily: 'Arial', fill: '#aaaaaa'
        });

        container.add([bg, edge, iconBg, dots, titleTxt, subTxt]);
        
        container.setInteractive(new Phaser.Geom.Rectangle(-w/2, -h/2, w, h), Phaser.Geom.Rectangle.Contains, { useHandCursor: true });
        
        container.on('pointerdown', callback);
        container.on('pointerover', () => {
            this.tweens.add({ targets: container, scale: 1.03, duration: 150 });
            edge.clear().lineStyle(3, color, 1).strokeRoundedRect(-w/2, -h/2, w, h, 12);
        });
        container.on('pointerout', () => {
            this.tweens.add({ targets: container, scale: 1, duration: 150 });
            edge.clear().lineStyle(2, color, 0.6).strokeRoundedRect(-w/2, -h/2, w, h, 12);
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

    async refreshRoomList() {
        if (!this.sys || !this.sys.isActive()) return;
        if (this.joinedRoom) return;

        const { data: rooms } = await supabase
            .from('ludo_rooms')
            .select(`*, ludo_players (id)`)
            .eq('status', 'LIVRE')
            .order('created_at', { ascending: false })
            .limit(10);

        this.roomsContainer.removeAll(true);
        if (!rooms || rooms.length === 0) {
            const emptyTxt = this.add.text(0, 50, 'Nenhuma sala pública encontrada.\nCrie uma acima para começar!', {
                fontSize: '16px', fontFamily: 'Arial', fill: '#888', align: 'center'
            }).setOrigin(0.5).setAlpha(0.7);
            this.roomsContainer.add(emptyTxt);
            return;
        }

        rooms.forEach((room, i) => {
            const item = this.createRoomListItem(0, i * 75, room);
            this.roomsContainer.add(item);
        });
    }

    createRoomListItem(x, y, room) {
        const container = this.add.container(x, y);
        const w = 450, h = 60;
        const playerCount = room.ludo_players?.length || 0;

        const bg = this.add.graphics();
        bg.fillStyle(0x1a1a2e, 0.7);
        bg.fillRoundedRect(-w/2, -h/2, w, h, 12);
        bg.lineStyle(1.5, 0xffffff, 0.2);
        bg.strokeRoundedRect(-w/2, -h/2, w, h, 12);

        const title = this.add.text(-w/2 + 20, 0, room.name.toUpperCase(), {
            fontSize: '16px', fontFamily: 'Arial Black', fill: '#fff'
        }).setOrigin(0, 0.5);

        const status = this.add.text(w/2 - 120, 0, `${playerCount}/${room.max_players} Jogadores`, {
            fontSize: '14px', fontFamily: 'Arial', fill: '#aaa'
        }).setOrigin(1, 0.5);

        const joinBtn = this.add.text(w/2 - 20, 0, 'ENTRAR', {
            fontSize: '14px', fontFamily: 'Arial Black', fill: '#4CAF50',
            backgroundColor: '#1e1e1e', padding: { x: 10, y: 5 }
        })
        .setOrigin(1, 0.5)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => this.joinRoom(room));

        container.add([bg, title, status, joinBtn]);

        // Hover Effect
        container.setInteractive(new Phaser.Geom.Rectangle(-w/2, -h/2, w, h), Phaser.Geom.Rectangle.Contains);
        container.on('pointerover', () => bg.lineStyle(1.5, 0xffffff, 0.6).strokeRoundedRect(-w/2, -h/2, w, h, 12));
        container.on('pointerout', () => bg.lineStyle(1.5, 0xffffff, 0.2).strokeRoundedRect(-w/2, -h/2, w, h, 12));

        return container;
    }

    async findOrCreateAndJoin(maxPlayers, variation = 'CLASSIC') {
        this.instructionText.setText("Buscando sala...");
        
        let nameSuffix = '';
        if (variation === 'TEAM') nameSuffix = ' | DUPLAS';
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
        this.roomsContainer.setVisible(false);
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
        }
        this.joinedRoom = null;
        this.myColor = null;
        this.waitingOverlay.setVisible(false);
        this.roomsContainer.setVisible(true);
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


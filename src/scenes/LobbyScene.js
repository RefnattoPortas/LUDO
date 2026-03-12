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
        const bg = this.add.image(cx, cy, 'lobby_bg');
        bg.setScale(Math.max(W / bg.width, H / bg.height) || 1);

        // Dark overlay
        this.add.rectangle(0, 0, W, H, 0x000000, 0.65).setOrigin(0);

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

        this.instructionText = this.add.text(cx, 135, 'Buscando salas disponíveis...', {
            fontSize: '18px', fontFamily: 'Arial', fill: '#aaaaaa'
        }).setOrigin(0.5);

        this.roomsContainer = this.add.container(0, 0);

        // Waiting Overlay (hidden by default)
        this.createWaitingOverlay(cx, cy, W, H);

        // Initial Data Fetch
        await this.refreshRooms();

        // Subscribe to room updates (Realtime)
        this.roomChannel = supabase
            .channel('lobby_rooms')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'ludo_rooms' }, () => this.refreshRooms())
            .on('postgres_changes', { event: '*', schema: 'public', table: 'ludo_players' }, () => this.onPlayerUpdate())
            .subscribe();

        // Handle page close/refresh to clean up
        this._unloadLobby = () => {
            if (this.joinedRoom && this.myColor) {
               // Fire-and-forget deletion
               supabase.from('ludo_players').delete().match({ room_id: this.joinedRoom.id, color: this.myColor }).then();
            }
        };
        window.addEventListener('beforeunload', this._unloadLobby);
    }

    createWaitingOverlay(cx, cy, W, H) {
        this.waitingOverlay = this.add.container(0, 0).setDepth(1000).setVisible(false);
        const bg = this.add.rectangle(0, 0, W, H, 0x000000, 0.85).setOrigin(0);
        
        const card = this.add.graphics();
        card.fillStyle(0x1a1a2e, 1);
        card.fillRoundedRect(cx - 150, cy - 100, 300, 200, 20);
        card.lineStyle(2, 0x2196F3, 1);
        card.strokeRoundedRect(cx - 150, cy - 100, 300, 200, 20);

        this.waitingTitle = this.add.text(cx, cy - 60, 'AGUARDANDO...', {
            fontSize: '22px', fontFamily: 'Arial Black', fill: '#fff'
        }).setOrigin(0.5);

        this.waitingStatus = this.add.text(cx, cy, 'Jogadores: 1/4', {
            fontSize: '18px', fontFamily: 'Arial', fill: '#aaa'
        }).setOrigin(0.5);

        const cancelBtn = this.add.text(cx, cy + 60, 'CANCELAR', {
            fontSize: '14px', fontFamily: 'Arial Black', fill: '#ff4444'
        })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => this.leaveRoom());

        this.waitingOverlay.add([bg, card, this.waitingTitle, this.waitingStatus, cancelBtn]);
    }

    async refreshRooms() {
        if (this.joinedRoom) return; // Don't refresh grid if already in a room waiting

        const { data: rooms, error } = await supabase
            .from('ludo_rooms')
            .select(`*, ludo_players (id)`)
            .order('id', { ascending: true });

        if (error) return;

        this.instructionText.setText('Escolha uma sala para entrar');
        this.roomsContainer.removeAll(true);

        const cx = this.cameras.main.centerX;
        const cy = this.cameras.main.centerY;
        const W = this.cameras.main.width;
        const H = this.cameras.main.height;

        const isMobile = W < H || W < 600;

        if (isMobile) {
            // List Layout (Mobile)
            const listStartY = cy - 120;
            const itemSpacingY = 110;

            rooms.forEach((room, i) => {
                const playerCount = room.ludo_players?.length || 0;
                const status = playerCount >= room.max_players ? 'CHEIA' : room.status || 'LIVRE';
                const card = this.createRoomCardList(cx, listStartY + (i * itemSpacingY), { ...room, playerCount, status });
                this.roomsContainer.add(card);
            });
        } else {
            // Grid Layout (PC/Landscape)
            const gridY = cy + 40;
            const spacingX = 220;
            const spacingY = 220;

            const positions = [
                { x: cx - spacingX/2, y: gridY - spacingY/2 },
                { x: cx + spacingX/2, y: gridY - spacingY/2 },
                { x: cx - spacingX/2, y: gridY + spacingY/2 },
                { x: cx + spacingX/2, y: gridY + spacingY/2 }
            ];

            rooms.forEach((room, i) => {
                if (i >= positions.length) return;
                const playerCount = room.ludo_players?.length || 0;
                const status = playerCount >= room.max_players ? 'CHEIA' : room.status || 'LIVRE';
                const card = this.createRoomCard(positions[i].x, positions[i].y, { ...room, playerCount, status });
                this.roomsContainer.add(card);
            });
        }
    }

    async onPlayerUpdate() {
        if (!this.joinedRoom) {
            await this.refreshRooms();
            return;
        }

        // Check current room players
        const { data: players } = await supabase
            .from('ludo_players')
            .select('color')
            .eq('room_id', this.joinedRoom.id);
        
        const count = players?.length || 0;
        this.waitingStatus.setText(`Jogadores: ${count}/${this.joinedRoom.max_players}`);

        if (count >= this.joinedRoom.max_players) {
            this.waitingTitle.setText('SALA CHEIA!');
            this.waitingStatus.setText('Iniciando partida...');
            
            // Get all players colors and sort them to maintain consistent turn order
            const colors = players.map(p => p.color);
            const orderedColors = ['RED', 'BLUE', 'YELLOW', 'GREEN'].filter(c => colors.includes(c));
            
            this.time.delayedCall(1500, () => {
                this.startGame(orderedColors);
            });
        }
    }

    createRoomCard(x, y, room) {
        const container = this.add.container(x, y);
        const w = 160, h = 160;

        const shadow = this.add.graphics();
        shadow.fillStyle(0x000000, 0.4);
        shadow.fillRoundedRect(-w/2 + 4, -h/2 + 6, w, h, 20);

        // Card bg
        const card = this.add.graphics();
        card.fillStyle(0x1a1a2e, 0.5);
        card.fillRoundedRect(-w/2, -h/2, w, h, 20);

        const color = room.status === 'EM JOGO' ? 0xFF9800 : room.status === 'CHEIA' ? 0xF44336 : 0x4CAF50;
        card.lineStyle(3, color, 1);
        card.strokeRoundedRect(-w/2, -h/2, w, h, 20);

        const title = this.add.text(0, -70, `SALA 0${room.id}`, {
            fontSize: '14px', fontFamily: 'Arial Black', fill: '#888'
        }).setOrigin(0.5);

        const name = this.add.text(0, -35, room.name, {
            fontSize: '16px', fontFamily: 'Arial Black', fill: '#fff'
        }).setOrigin(0.5);

        const playersIcon = this.add.text(0, 10, `${room.playerCount}/${room.max_players}`, {
            fontSize: '38px', fontFamily: 'Arial Black', fill: '#fff'
        }).setOrigin(0.5);

        const badgeText = this.add.text(0, 61, room.status, {
            fontSize: '10px', fontFamily: 'Arial Black', fill: '#fff'
        }).setOrigin(0.5);

        container.add([shadow, card, title, name, playersIcon, badgeText]);
        container.setInteractive(new Phaser.Geom.Rectangle(-w/2, -h/2, w, h), Phaser.Geom.Rectangle.Contains, { useHandCursor: true });

        container.on('pointerdown', () => {
            if (room.status === 'CHEIA') return;
            this.joinRoom(room);
        });

        return container;
    }

    createRoomCardList(x, y, room) {
        const container = this.add.container(x, y);
        const w = 272, h = 72;

        const shadow = this.add.graphics();
        shadow.fillStyle(0x000000, 0.4);
        shadow.fillRoundedRect(-w/2 + 4, -h/2 + 4, w, h, 15);

        const card = this.add.graphics();
        card.fillStyle(0x1a1a2e, 0.5);
        card.fillRoundedRect(-w/2, -h/2, w, h, 15);

        const color = room.status === 'EM JOGO' ? 0xFF9800 : room.status === 'CHEIA' ? 0xF44336 : 0x4CAF50;
        card.lineStyle(2, color, 1);
        card.strokeRoundedRect(-w/2, -h/2, w, h, 15);

        const name = this.add.text(-w/2 + 20, 0, room.name, {
            fontSize: '18px', fontFamily: 'Arial Black', fill: '#fff'
        }).setOrigin(0, 0.5);

        const playerCount = this.add.text(w/2 - 80, 0, `${room.playerCount}/${room.max_players}`, {
            fontSize: '24px', fontFamily: 'Arial Black', fill: '#fff'
        }).setOrigin(0.5);

        const badgeText = this.add.text(w/2 - 35, 0, room.status, {
            fontSize: '10px', fontFamily: 'Arial Black', fill: color
        }).setOrigin(0.5).setAngle(90);

        container.add([shadow, card, name, playerCount, badgeText]);
        container.setInteractive(new Phaser.Geom.Rectangle(-w/2, -h/2, w, h), Phaser.Geom.Rectangle.Contains, { useHandCursor: true });

        container.on('pointerdown', () => {
            if (room.status === 'CHEIA') return;
            this.joinRoom(room);
        });

        return container;
    }

    async joinRoom(room) {
        const { data: existingPlayers } = await supabase
            .from('ludo_players')
            .select('color')
            .eq('room_id', room.id);
        
        const takenColors = existingPlayers?.map(p => p.color) || [];
        
        // Custom Rule: 2-player room color pairs
        let availableColors = ['RED', 'BLUE', 'YELLOW', 'GREEN'];
        if (room.id === 1) {
            availableColors = ['RED', 'YELLOW'];
        } else if (room.id === 2) {
            availableColors = ['BLUE', 'GREEN'];
        }

        this.myColor = availableColors.find(c => !takenColors.includes(c));

        if (!this.myColor) {
            alert('A sala está cheia!');
            return;
        }

        // Join
        const { error } = await supabase.from('ludo_players').insert({
            room_id: room.id,
            color: this.myColor,
            last_active: new Date()
        });

        if (error) {
            console.error(error);
            return;
        }

        this.joinedRoom = room;
        this.waitingOverlay.setVisible(true);
        this.roomsContainer.setVisible(false);
        this.onPlayerUpdate();
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
        this.refreshRooms();
    }

    leaveAndBack() {
        this.leaveRoom();
        this.scene.start('MenuScene');
    }

    startGame(activePlayers) {
        if (!this.joinedRoom) return;

        this.cameras.main.fadeOut(300, 0, 0, 0);
        this.cameras.main.once('camerafadeoutcomplete', () => {
            this.scene.start('GameScene', {
                mode: 'ONLINE',
                roomId: this.joinedRoom.id,
                playerColor: this.myColor,
                activePlayers: activePlayers,
                isNewMatch: true
            });
        });
    }

    shutdown() {
        if (this.roomChannel) supabase.removeChannel(this.roomChannel);
        if (this._unloadLobby) window.removeEventListener('beforeunload', this._unloadLobby);
    }
}

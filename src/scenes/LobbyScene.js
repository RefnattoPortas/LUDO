import Phaser from 'phaser';
import { supabase } from '../supabase';

export class LobbyScene extends Phaser.Scene {
    constructor() {
        super('LobbyScene');
    }

    preload() {
        this.load.image('lobby_bg', '/lobby_bg_cartoon.png');
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
        this.titleText = this.add.text(cx, 100, 'Ludo Online', {
            fontSize: '48px', fontFamily: 'Arial Black, Arial', fontWeight: 'bold', fill: '#ffffff',
            shadow: { offsetX: 3, offsetY: 4, color: '#000', blur: 10, fill: true }
        }).setOrigin(0.5);

        this.instructionText = this.add.text(cx, 160, 'Selecione o modo de jogo', {
            fontSize: '20px', fontFamily: 'Arial', fill: '#cccccc'
        }).setOrigin(0.5);

        this.onlineCountText = this.add.text(W - 30, 30, 'Online: ...', {
            fontSize: '17px', fontFamily: 'Arial Black', fill: '#4CAF50',
            backgroundColor: '#000000', padding: { x: 10, y: 6 }
        }).setOrigin(1, 0).setAlpha(0.9).setDepth(10);

        // --- SCROLLABLE LIST SETUP ---
        this.listY = 200;
        this.listHeight = H - this.listY - 20;
        
        // Mask for the scrollable area - Using make.graphics with add:false so it's not visible
        const maskShape = this.make.graphics({ add: false });
        maskShape.fillStyle(0xffffff);
        maskShape.fillRect(0, this.listY, W, this.listHeight);
        const listMask = maskShape.createGeometryMask();

        this.roomsContainer = this.add.container(0, 0);
        this.roomsContainer.setMask(listMask);

        // Interaction for scrolling
        this.input.on('wheel', (pointer, gameObjects, deltaX, deltaY) => {
            if (this.joinedRoom) return;
            this.scrollList(-deltaY * 0.5);
        });

        let dragY = 0;
        this.input.on('pointerdown', (p) => dragY = p.y);
        this.input.on('pointermove', (p) => {
            if (p.isDown && !this.joinedRoom) {
                const diff = p.y - dragY;
                dragY = p.y;
                this.scrollList(diff);
            }
        });

        // Waiting Overlay (hidden by default)
        this.createWaitingOverlay(cx, cy, W, H);

        // Initial Data Fetch
        await this.cleanupStalePlayers();
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
    
    scrollList(amount) {
        const minHeight = this.listHeight;
        const contentHeight = Math.max(minHeight, this.maxScrollY || 0);
        
        this.roomsContainer.y += amount;
        
        // Bounds
        const limit = -(contentHeight - minHeight + 100);
        if (this.roomsContainer.y > 0) this.roomsContainer.y = 0;
        if (this.roomsContainer.y < limit) this.roomsContainer.y = limit;
    }

    async refreshRooms() {
        if (this.joinedRoom) return;

        await this.cleanupStalePlayers();

        const { count: totalPlayers } = await supabase
            .from('ludo_players')
            .select('*', { count: 'exact', head: true });

        this.onlineCountText.setText(`Online: ${totalPlayers || 0}`);
        this.roomsContainer.removeAll(true);
        this.roomsContainer.y = 0;

        const cx = this.cameras.main.centerX;
        const W = this.cameras.main.width;
        
        // On mobile and desktop, we now use a consistent LIST layout for "infinite" scroll feel
        let currentY = this.listY + 50; 

        // --- MATCHMAKING SECTION (Always top list items) ---
        this.createMatchmakingCardList(cx, currentY, 2);
        currentY += 100;
        this.createMatchmakingCardList(cx, currentY, 4);
        currentY += 120;

        // --- PUBLIC ROOMS SECTION ---
        const { data: rooms } = await supabase
            .from('ludo_rooms')
            .select(`*, ludo_players (id)`)
            .order('id', { ascending: true });

        if (rooms) {
            const sectionTitle = this.add.text(cx, currentY, 'Salas Públicas', {
                fontSize: '18px', fontFamily: 'Arial Black', fill: '#888'
            }).setOrigin(0.5).setAlpha(0.6);
            this.roomsContainer.add(sectionTitle);
            
            currentY += 60;

            rooms.forEach((room) => {
                const playerCount = room.ludo_players?.length || 0;
                const status = playerCount >= room.max_players ? 'CHEIA' : room.status || 'LIVRE';
                this.createRoomCardList(cx, currentY, { ...room, playerCount, status });
                currentY += 100;
            });
        }
        
        this.maxScrollY = currentY;
    }

    createMatchmakingCardList(x, y, size) {
        const container = this.add.container(x, y);
        this.roomsContainer.add(container);
        const w = 400, h = 80;

        const shadow = this.add.graphics();
        shadow.fillStyle(0x000000, 0.4);
        shadow.fillRoundedRect(-w/2 + 4, -h/2 + 4, w, h, 15);

        const card = this.add.graphics();
        const color = size === 2 ? 0x2196F3 : 0x9C27B0;
        
        card.fillStyle(0x1a1a2e, 0.85);
        card.fillRoundedRect(-w/2, -h/2, w, h, 15);
        card.lineStyle(3, color, 1);
        card.strokeRoundedRect(-w/2, -h/2, w, h, 15);

        const title = this.add.text(-w/2 + 20, 0, `ALEATÓRIO (${size} JOG.)`, {
            fontSize: '18px', fontFamily: 'Arial Black', fill: '#fff'
        }).setOrigin(0, 0.5);

        const icon = this.add.text(w/2 - 40, 0, '⚡', { fontSize: '24px' }).setOrigin(0.5);

        container.add([shadow, card, title, icon]);
        container.setInteractive(new Phaser.Geom.Rectangle(-w/2, -h/2, w, h), Phaser.Geom.Rectangle.Contains, { useHandCursor: true });

        container.on('pointerover', () => {
            this.tweens.add({ targets: container, scale: 1.02, duration: 100 });
            card.lineStyle(4, 0xffffff, 1);
            card.strokeRoundedRect(-w/2, -h/2, w, h, 15);
        });

        container.on('pointerout', () => {
            this.tweens.add({ targets: container, scale: 1, duration: 100 });
            card.lineStyle(3, color, 1);
            card.strokeRoundedRect(-w/2, -h/2, w, h, 15);
        });

        container.on('pointerdown', () => this.handleMatchmaking(size));
    }

    createMatchmakingCard(x, y, size) {
        const container = this.add.container(x, y);
        this.roomsContainer.add(container); // Add to main container
        const w = 240, h = 120;

        const shadow = this.add.graphics();
        shadow.fillStyle(0x000000, 0.4);
        shadow.fillRoundedRect(-w/2 + 5, -h/2 + 7, w, h, 20);

        const card = this.add.graphics();
        const color = size === 2 ? 0x2196F3 : 0x9C27B0; // Blue for 2, Purple for 4
        
        card.fillStyle(0x1a1a2e, 0.8);
        card.fillRoundedRect(-w/2, -h/2, w, h, 20);
        card.lineStyle(3, color, 1);
        card.strokeRoundedRect(-w/2, -h/2, w, h, 20);

        const title = this.add.text(0, -25, 'ALEATÓRIO', {
            fontSize: '14px', fontFamily: 'Arial Black', fill: '#aaa'
        }).setOrigin(0.5);

        const mainText = this.add.text(0, 10, `${size} JOGADORES`, {
            fontSize: '22px', fontFamily: 'Arial Black', fill: '#fff'
        }).setOrigin(0.5);

        container.add([shadow, card, title, mainText]);
        container.setInteractive(new Phaser.Geom.Rectangle(-w/2, -h/2, w, h), Phaser.Geom.Rectangle.Contains, { useHandCursor: true });

        container.on('pointerover', () => {
            this.tweens.add({ targets: container, scale: 1.05, duration: 100 });
            card.lineStyle(4, 0xffffff, 1);
            card.strokeRoundedRect(-w/2, -h/2, w, h, 20);
        });

        container.on('pointerout', () => {
            this.tweens.add({ targets: container, scale: 1, duration: 100 });
            card.lineStyle(3, color, 1);
            card.strokeRoundedRect(-w/2, -h/2, w, h, 20);
        });

        container.on('pointerdown', () => {
            this.handleMatchmaking(size);
        });

        this.roomsContainer.add(container);
    }

    async handleMatchmaking(size) {
        this.instructionText.setText('Procurando partida...');
        
        // 1. Get all compatible rooms
        const { data: rooms } = await supabase
            .from('ludo_rooms')
            .select('*, ludo_players (id)')
            .eq('status', 'LIVRE')
            .eq('max_players', size);
        
        // 2. Find a room that has players but is not full
        // Sort DESC by player count to group people together in partially filled rooms
        let roomToJoin = rooms?.sort((a, b) => (b.ludo_players?.length || 0) - (a.ludo_players?.length || 0))
                             .find(r => (r.ludo_players?.length || 0) < size);

        // 3. Fallback: Find an empty room
        if (!roomToJoin) {
            const { data: emptyRooms } = await supabase
                .from('ludo_rooms')
                .select('*, ludo_players (id)')
                .eq('status', 'LIVRE');
            
            roomToJoin = emptyRooms?.find(r => (r.ludo_players?.length || 0) === 0);
        }

        // 4. Fallback 2: Create a new room automatically
        if (!roomToJoin) {
            const { data: newRoom, error } = await supabase
                .from('ludo_rooms')
                .insert({
                    name: `Aleatorio (${size} JOG.)`,
                    max_players: size,
                    status: 'LIVRE'
                })
                .select()
                .single();
            
            if (!error) roomToJoin = newRoom;
        }

        if (roomToJoin) {
            this.initiateJoin(roomToJoin);
        } else {
            alert('Não foi possível entrar em uma sala. Tente novamente.');
            this.refreshRooms();
        }
    }

    async initiateJoin(room) {
        const { data: existingPlayers } = await supabase
            .from('ludo_players')
            .select('color')
            .eq('room_id', room.id);
        
        const takenColors = existingPlayers?.map(p => p.color) || [];
        
        // Restore custom room color rules
        let availableColors = ['RED', 'BLUE', 'YELLOW', 'GREEN'];
        if (room.id == 1) availableColors = ['RED', 'YELLOW'];
        else if (room.id == 2) availableColors = ['BLUE', 'GREEN'];
        else availableColors = availableColors.slice(0, room.max_players);

        this.myColor = availableColors.find(c => !takenColors.includes(c));

        if (!this.myColor) {
            if (this.instructionText.text.includes('Procurando')) {
                 this.handleMatchmaking(room.max_players);
            } else {
                 alert('A sala está cheia!');
            }
            return;
        }

        const { error } = await supabase.from('ludo_players').insert({
            room_id: room.id,
            color: this.myColor,
            last_active: new Date()
        });

        if (error) {
            this.refreshRooms();
            return;
        }

        this.joinedRoom = room;
        this.waitingOverlay.setVisible(true);
        this.roomsContainer.setVisible(false);
        this.onPlayerUpdate();
    }

    createRoomCard(x, y, room) {
        const container = this.add.container(x, y);
        const w = 200, h = 160;

        const shadow = this.add.graphics();
        shadow.fillStyle(0x000000, 0.4);
        shadow.fillRoundedRect(-w/2 + 4, -h/2 + 6, w, h, 20);

        const card = this.add.graphics();
        card.fillStyle(0x1a1a2e, 0.5);
        card.fillRoundedRect(-w/2, -h/2, w, h, 20);

        const color = room.status === 'EM JOGO' ? 0xFF9800 : room.status === 'CHEIA' ? 0xF44336 : 0x4CAF50;
        card.lineStyle(2, color, 1);
        card.strokeRoundedRect(-w/2, -h/2, w, h, 20);

        const name = this.add.text(0, -30, room.name, {
            fontSize: '15px', fontFamily: 'Arial Black', fill: '#fff'
        }).setOrigin(0.5);

        const playersIcon = this.add.text(0, 15, `${room.playerCount}/${room.max_players}`, {
            fontSize: '32px', fontFamily: 'Arial Black', fill: '#fff'
        }).setOrigin(0.5);

        const badgeText = this.add.text(0, 50, room.status, {
            fontSize: '10px', fontFamily: 'Arial Black', fill: color
        }).setOrigin(0.5);

        container.add([shadow, card, name, playersIcon, badgeText]);
        container.setInteractive(new Phaser.Geom.Rectangle(-w/2, -h/2, w, h), Phaser.Geom.Rectangle.Contains, { useHandCursor: true });

        container.on('pointerdown', () => {
            if (room.status === 'CHEIA' || room.status === 'EM JOGO') return;
            this.initiateJoin(room);
        });

        return container;
    }

    createRoomCardList(x, y, room) {
        const container = this.add.container(x, y);
        this.roomsContainer.add(container);
        const w = 400, h = 80;

        const shadow = this.add.graphics();
        shadow.fillStyle(0x000000, 0.4);
        shadow.fillRoundedRect(-w/2 + 4, -h/2 + 4, w, h, 15);

        const card = this.add.graphics();
        card.fillStyle(0x1a1a2e, 0.7);
        card.fillRoundedRect(-w/2, -h/2, w, h, 15);

        const color = room.status === 'EM JOGO' ? 0xFF9800 : room.status === 'CHEIA' ? 0xF44336 : 0x4CAF50;
        card.lineStyle(2, color, 1);
        card.strokeRoundedRect(-w/2, -h/2, w, h, 15);

        const name = this.add.text(-w/2 + 20, 0, room.name, {
            fontSize: '16px', fontFamily: 'Arial Black', fill: '#fff'
        }).setOrigin(0, 0.5);

        const playerCount = this.add.text(w/2 - 80, 0, `${room.playerCount}/${room.max_players}`, {
            fontSize: '20px', fontFamily: 'Arial Black', fill: '#fff'
        }).setOrigin(0.5);

        const badgeText = this.add.text(w/2 - 35, 0, room.status, {
            fontSize: '10px', fontFamily: 'Arial Black', fill: color
        }).setOrigin(0.5).setAngle(90);

        container.add([shadow, card, name, playerCount, badgeText]);
        container.setInteractive(new Phaser.Geom.Rectangle(-w/2, -h/2, w, h), Phaser.Geom.Rectangle.Contains, { useHandCursor: true });

        container.on('pointerdown', () => {
             if (room.status === 'CHEIA' || room.status === 'EM JOGO') return;
            this.initiateJoin(room);
        });

        return container;
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
        await this.cleanupStalePlayers();
        await this.refreshRooms();
    }

    async cleanupStalePlayers() {
        // 1. Delete inactive players
        const twentyFiveSecondsAgo = new Date(Date.now() - 25000).toISOString();
        const { error } = await supabase
            .from('ludo_players')
            .delete()
            .lt('last_active', twentyFiveSecondsAgo);
        
        if (error) console.warn('Cleanup error:', error);

        // 2. Check rooms that are "EM JOGO" or "CHEIA" but have too few players (abandoned)
        const { data: rooms } = await supabase.from('ludo_rooms').select('id, status, max_players, ludo_players(id)');
        if (rooms) {
            for (const r of rooms) {
                const count = r.ludo_players?.length || 0;
                // If the game has less than 2 players, it's basically dead/orphaned
                if (count < 2 && (r.status === 'EM JOGO' || r.status === 'CHEIA')) {
                    await supabase.from('ludo_rooms').update({ status: 'LIVRE' }).eq('id', r.id);
                } 
                // Also ensures that if a room is 0 and LIVRE but has wrong max_players, it can be reused later.
                else if (count === 0 && r.status === 'CHEIA') {
                    await supabase.from('ludo_rooms').update({ status: 'LIVRE' }).eq('id', r.id);
                }
            }
        }
    }

    leaveAndBack() {
        this.leaveRoom();
        this.scene.start('MenuScene');
    }

    async startGame(activePlayers) {
        if (!this.joinedRoom) return;

        // Set room status to EM JOGO so new matchmakers don't join
        await supabase.from('ludo_rooms').update({ status: 'EM JOGO' }).eq('id', this.joinedRoom.id);

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

import { MenuScene } from './scenes/MenuScene';
import { GameScene } from './scenes/GameScene';

const config = {
    type: Phaser.AUTO,
    width: 640,
    height: 780,
    parent: 'app',
    backgroundColor: '#1a1a1a',
    scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH
    },
    scene: [MenuScene, GameScene]
};

new Phaser.Game(config);

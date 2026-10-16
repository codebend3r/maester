#pragma once
#import <Cocoa/Cocoa.h>
#import <QuartzCore/CAMetalLayer.h>

// BrowserWindow's handle is an NSView pointer, not an NSWindow pointer.
@interface RavenVideoView : NSView
@property(nonatomic) NSUInteger sortRepairs;
@property(nonatomic) BOOL isRepairingSort;
- (void)updateDrawable;
@end

struct RavenSurface {
    __strong NSView *content = nil;
    __strong RavenVideoView *view = nil;
    Class originalClass = Nil;
    Class hookedClass = Nil;
    void attach(void *nativeView);
    void detach();
    CAMetalLayer *layer() const;
    double refreshRate() const;
    double edrHeadroom() const;
};

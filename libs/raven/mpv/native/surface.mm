#import "surface.h"
#import <QuartzCore/QuartzCore.h>
#import <objc/runtime.h>
#include <stdexcept>

static char surfaceKey;

@implementation RavenVideoView
+ (Class)layerClass { return [CAMetalLayer class]; }
- (CALayer *)makeBackingLayer { return [CAMetalLayer layer]; }
- (BOOL)isAccessibilityElement { return NO; }
- (NSView *)hitTest:(NSPoint)point { return nil; }
- (void)setFrameSize:(NSSize)size {
    [super setFrameSize:size];
    [self updateDrawable];
}
- (void)viewDidChangeBackingProperties {
    [super viewDidChangeBackingProperties];
    [self updateDrawable];
}
- (void)viewDidMoveToWindow {
    [super viewDidMoveToWindow];
    [self updateDrawable];
}
- (void)updateDrawable {
    CAMetalLayer *layer = (CAMetalLayer *)self.layer;
    if (!layer) return;
    CGFloat scale = self.window.backingScaleFactor;
    if (scale <= 0) scale = 1;
    [CATransaction begin];
    [CATransaction setDisableActions:YES];
    layer.contentsScale = scale;
    layer.drawableSize = CGSizeMake(self.bounds.size.width * scale, self.bounds.size.height * scale);
    [CATransaction commit];
}
@end

// Chromium's content-view sort can promote foreign views without a frame change.
// Hook only this instance, preserve its original class, and repair after its sort.
static void repairSort(NSView *content) {
    RavenVideoView *view = objc_getAssociatedObject(content, &surfaceKey);
    if (!view || view.isRepairingSort || content.subviews.firstObject == view) return;
    view.isRepairingSort = YES;
    [content addSubview:view positioned:NSWindowBelow relativeTo:nil];
    view.sortRepairs += 1;
    view.isRepairingSort = NO;
    NSLog(@"raven mpv: repaired content-view sort (%lu)", (unsigned long)view.sortRepairs);
}

void RavenSurface::attach(void *nativeView) {
    if (![NSThread isMainThread]) throw std::runtime_error("Video surface requires the macOS main thread");
    NSView *native = (__bridge NSView *)nativeView;
    NSWindow *window = native.window;
    if (!window || !window.contentView) throw std::runtime_error("BrowserWindow has no content view");
    content = window.contentView;
    if (objc_getAssociatedObject(content, &surfaceKey)) throw std::runtime_error("Window already has an mpv surface");
    originalClass = object_getClass(content);
    NSString *name = [@"RavenMpv_" stringByAppendingString:NSStringFromClass(originalClass)];
    hookedClass = NSClassFromString(name);
    if (!hookedClass) {
        hookedClass = objc_allocateClassPair(originalClass, name.UTF8String, 0);
        Method method = class_getInstanceMethod(originalClass, @selector(sortSubviewsUsingFunction:context:));
        if (!hookedClass || !method) throw std::runtime_error("Cannot hook content-view sorting");
        using Sort = void (*)(id, SEL, NSComparisonResult (*)(id, id, void *), void *);
        Sort originalSort = (Sort)method_getImplementation(method);
        IMP replacement = imp_implementationWithBlock(^(NSView *self, NSComparisonResult (*compare)(id, id, void *), void *context) {
            originalSort(self, @selector(sortSubviewsUsingFunction:context:), compare, context);
            repairSort(self);
        });
        if (!class_addMethod(hookedClass, @selector(sortSubviewsUsingFunction:context:), replacement, method_getTypeEncoding(method))) {
            imp_removeBlock(replacement);
            objc_disposeClassPair(hookedClass);
            throw std::runtime_error("Cannot hook content-view sorting");
        }
        objc_registerClassPair(hookedClass);
    }
    view = [[RavenVideoView alloc] initWithFrame:content.bounds];
    view.wantsLayer = YES;
    view.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    view.layer.opaque = YES;
    ((CAMetalLayer *)view.layer).wantsExtendedDynamicRangeContent = YES;
    objc_setAssociatedObject(content, &surfaceKey, view, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    object_setClass(content, hookedClass);
    [content addSubview:view positioned:NSWindowBelow relativeTo:nil];
    [view updateDrawable];
}

void RavenSurface::detach() {
    if (!content) return;
    objc_setAssociatedObject(content, &surfaceKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    if (object_getClass(content) == hookedClass) object_setClass(content, originalClass);
    [view removeFromSuperview];
    view = nil;
    content = nil;
}

CAMetalLayer *RavenSurface::layer() const { return (CAMetalLayer *)view.layer; }

double RavenSurface::refreshRate() const {
    NSScreen *screen = view.window.screen;
    if (!screen) return 0;
    NSNumber *number = screen.deviceDescription[@"NSScreenNumber"];
    CGDisplayModeRef mode = CGDisplayCopyDisplayMode(number.unsignedIntValue);
    double fps = mode ? CGDisplayModeGetRefreshRate(mode) : 0;
    if (mode) CGDisplayModeRelease(mode);
    return fps > 0 ? fps : screen.maximumFramesPerSecond;
}

double RavenSurface::edrHeadroom() const {
    NSScreen *screen = view.window.screen;
    return screen ? screen.maximumPotentialExtendedDynamicRangeColorComponentValue : 1;
}
